import type { Node } from 'web-tree-sitter';
import { Edits, UnsupportedTrace, clean, fail, field, firstError, line, named, type ConditionMeta } from './instrument.ts';

/**
 * Java instrumentation: the reader's program, with calls into
 * OfficinaTrace.java added.
 *
 * Every method's body is wrapped so its entry, its return and an exception
 * leaving it are all seen. Each statement gets `OfficinaTrace.at(line)`
 * before it and a step after it that passes the values of the local
 * variables in scope — only those the compiler agrees have a value, since
 * reading any other is a compile error in Java. Every test of an if, loop or
 * `?:` is wrapped so its result and operands are recorded as the program
 * computes them, once.
 *
 * Nothing inside a lambda is instrumented: its statements run as part of
 * whatever called it, and the trace shows the calls it makes.
 */

export interface InstrumentedJava {
  /** The program, to be compiled as `${file}.java`. */
  code: string;
  file: string;
  conditions: ConditionMeta[];
  /** Names, types, sites and classes for OfficinaTrace, passed as an argument. */
  tables: string;
}

interface Local {
  name: string;
  type: string;
  assigned: boolean;
}

const LITERALS = /(_literal|^true|^false)$/;
const TYPES = new Set(['class_declaration', 'enum_declaration', 'interface_declaration', 'record_declaration', 'annotation_type_declaration']);
const BODIES = new Set(['class_body', 'enum_body', 'interface_body', 'enum_body_declarations', 'record_body']);
const T = 'OfficinaTrace';

/** The expression inside `(…)` — tree-sitter-java names an if's `condition` node. */
const inner = (n: Node | null) => (n && (n.type === 'condition' || n.type === 'parenthesized_expression') ? named(n)[0] : n);

export function instrumentJava(root: Node, source: string): InstrumentedJava {
  if (root.hasError) fail(firstError(root) ?? root, 'This does not parse as Java');
  const reserved = /\b(_ot\w*|OfficinaTrace)\b/.exec(source);
  if (reserved) throw new UnsupportedTrace(`${reserved[1]} is a name the tracer uses; rename it.`);
  for (const n of root.descendantsOfType('object_creation_expression')) {
    if (n && field(n, 'type')?.text === 'Thread') fail(n, 'Threads cannot be traced: the tracer follows one thread');
  }
  for (const n of root.descendantsOfType('superclass')) {
    if (n && /\bThread\b/.test(n.text)) fail(n, 'Threads cannot be traced: the tracer follows one thread');
  }

  const edits = new Edits();
  const conditions: ConditionMeta[] = [];
  const tables = { names: new Map<string, number>(), types: new Map<string, number>(), functions: new Map<string, number>(), classes: new Map<string, number>() };
  const id = (table: Map<string, number>, key: string) => {
    if (!table.has(key)) table.set(key, table.size);
    return table.get(key)!;
  };
  const sites = new Map<string, number>();
  const functionClass: number[] = [];
  let loops = 0;

  // A package line would put the program where OfficinaTrace cannot reach it;
  // it is blanked, keeping every other line where it was.
  for (const p of named(root)) {
    if (p.type === 'package_declaration') edits.replace(p.startIndex, p.endIndex, ' '.repeat(p.endIndex - p.startIndex));
  }

  // ── Classes, by their binary names ──
  const binary = new Map<number, string>();
  const nameClasses = (n: Node, outer: string | null) => {
    for (const c of named(n)) {
      if (TYPES.has(c.type)) {
        const name = field(c, 'name')!.text;
        const full = outer ? `${outer}$${name}` : name;
        binary.set(c.id, full);
        nameClasses(field(c, 'body')!, full);
      } else if (BODIES.has(c.type)) nameClasses(c, outer);
    }
  };
  nameClasses(root, null);
  const classOf = (n: Node): Node | null => {
    for (let p = n.parent; p; p = p.parent) if (binary.has(p.id)) return p;
    return null;
  };

  // ── The entry point ──
  let entry: Node | null = null;
  for (const m of root.descendantsOfType('method_declaration')) {
    if (!m || field(m, 'name')?.text !== 'main') continue;
    const modifiers = named(m).find((c) => c.type === 'modifiers')?.text ?? '';
    const params = named(field(m, 'parameters'));
    const param = params[0]?.text.replace(/\s+/g, '') ?? '';
    if (/\bstatic\b/.test(modifiers) && field(m, 'type')?.text === 'void' && params.length === 1
      && /^(final)?(java\.lang\.)?String(\[\][\w$]+|\.\.\.[\w$]+|[\w$]+\[\])$/.test(param)) {
      if (entry) fail(m, 'A program traced here has one main method');
      entry = m;
    }
  }
  if (!entry) throw new UnsupportedTrace('There is no public static void main(String[] args) to start from.');
  const entryClass = classOf(entry)!;
  const entryName = binary.get(entryClass.id)!;
  const publicTop = named(root).find((c) => TYPES.has(c.type) && /\bpublic\b/.test(named(c).find((m) => m.type === 'modifiers')?.text ?? ''));
  const file = publicTop ? field(publicTop, 'name')!.text : entryName.split('$')[0];

  // ── Sites: which variables a step passes ──
  const site = (scope: Local[]) => {
    const visible = scope.filter((v) => v.assigned);
    const pairs = visible.map((v) => `${id(tables.names, v.name)},${id(tables.types, v.type)}`).join(',');
    if (!sites.has(pairs)) sites.set(pairs, sites.size);
    return { id: sites.get(pairs)!, values: `new Object[]{${visible.map((v) => v.name).join(',')}}` };
  };
  const typeOf = (typeNode: Node, declarator: Node | null) => clean(typeNode.text + (field(declarator, 'dimensions')?.text ?? '')).replace(/\s*\[\s*\]/g, '[]');

  // ── Conditions ──
  function operandsOf(expr: Node, cid: number, operands: string[]) {
    const operand = (e: Node | null) => {
      if (!e || LITERALS.test(e.type) || e.type === 'null_literal') return;
      const k = operands.length;
      operands.push(clean(e.text));
      edits.wrap(e.startIndex, e.endIndex, `${T}.v(${cid},${k},`, ')');
    };
    const walk = (e: Node | null) => {
      if (!e) return;
      if (e.type === 'parenthesized_expression') return walk(named(e)[0]);
      if (e.type === 'binary_expression') {
        const op = field(e, 'operator')?.type ?? '';
        if (op === '&&' || op === '||') { walk(field(e, 'left')); walk(field(e, 'right')); }
        else if (['==', '!=', '<', '>', '<=', '>='].includes(op)) { operand(field(e, 'left')); operand(field(e, 'right')); }
        return;
      }
      if (e.type === 'unary_expression' && field(e, 'operator')?.type === '!') return walk(field(e, 'operand'));
      if (['identifier', 'field_access', 'array_access'].includes(e.type)) operand(e);
    };
    walk(expr);
  }

  function condition(expr: Node, kind: ConditionMeta['kind'], at: number, scope: Local[], loop: number) {
    const cid = conditions.length;
    const operands: string[] = [];
    conditions.push({ kind, expr: clean(expr.text), line: at, operands });
    const s = site(scope);
    edits.wrap(expr.startIndex, expr.endIndex, `${T}.cond(${T}.at(${at}),${cid},(`, `),${s.id},${loop},${s.values})`);
    operandsOf(expr, cid, operands);
    ternaries(expr);
  }

  /** Every `?:` evaluated inside `node`, but not in a lambda or a class inside it. */
  function ternaries(node: Node | null) {
    if (!node) return;
    const visit = (n: Node) => {
      if (n.type === 'lambda_expression' || n.type === 'class_body' || n.type === 'switch_label') return;
      if (n.type === 'ternary_expression') {
        const test = field(n, 'condition')!;
        const cid = conditions.length;
        const operands: string[] = [];
        conditions.push({ kind: 'ternary', expr: clean(test.text), line: line(n), operands });
        edits.wrap(test.startIndex, test.endIndex, `${T}.test(${cid},(`, '))');
        operandsOf(test, cid, operands);
        for (const c of named(n)) visit(c);
        return;
      }
      for (const c of named(n)) visit(c);
    };
    visit(node);
  }

  // ── Statements ──
  let returnType = 'void';
  const brace = (n: Node) => {
    if (n.type !== 'block') edits.wrap(n.startIndex, n.endIndex, '{', '}');
  };
  const merge = (scope: Local[], after: Local[]) => scope.map((v) => after.find((w) => w.name === v.name) ?? v);

  /** Instrument one statement; returns the scope after it, for definite assignment. */
  function statement(n: Node, scope: Local[], label: Node | null = null): Local[] {
    const at = line(n);
    const outer = label ?? n;                 // where a loop's own setup goes: before its label
    switch (n.type) {
      case 'block': {
        let s = scope;
        for (const c of named(n)) s = statement(c, s);
        return merge(scope, s);
      }
      case 'local_variable_declaration': {
        const typeNode = field(n, 'type')!;
        const added = n.childrenForFieldName('declarator').filter((d): d is Node => d !== null).map((d) => ({
          name: field(d, 'name')!.text,
          type: typeOf(typeNode, d),
          assigned: !!field(d, 'value'),
        }));
        const after = [...scope.filter((v) => !added.some((a) => a.name === v.name)), ...added];
        const s = site(after);
        edits.wrap(n.startIndex, n.endIndex, `${T}.at(${at});`, `${T}.step(${at},${s.id},${s.values});`);
        ternaries(n);
        return after;
      }
      case 'expression_statement': {
        const e = named(n)[0];
        let after = scope;
        if (e?.type === 'assignment_expression' && field(e, 'operator')?.type === '=' && field(e, 'left')?.type === 'identifier') {
          const target = field(e, 'left')!.text;
          after = scope.map((v) => (v.name === target ? { ...v, assigned: true } : v));
        }
        const s = site(after);
        edits.wrap(n.startIndex, n.endIndex, `${T}.at(${at});`, `${T}.step(${at},${s.id},${s.values});`);
        ternaries(n);
        return after;
      }
      case 'assert_statement': {
        const s = site(scope);
        edits.wrap(n.startIndex, n.endIndex, `${T}.at(${at});`, `${T}.step(${at},${s.id},${s.values});`);
        return scope;
      }
      case 'if_statement': {
        condition(inner(field(n, 'condition'))!, 'if', at, scope, -1);
        const yes = field(n, 'consequence')!;
        brace(yes);
        const a = statement(yes, scope);
        const other = field(n, 'alternative');
        if (!other) return scope;
        brace(other);
        const b = statement(other, scope);
        return scope.map((v) => ({ ...v, assigned: v.assigned || (!!a.find((w) => w.name === v.name)?.assigned && !!b.find((w) => w.name === v.name)?.assigned) }));
      }
      case 'while_statement': {
        const loop = loops++;
        edits.insert(outer.startIndex, `${T}.loop(${loop},0);`);
        condition(inner(field(n, 'condition'))!, 'while', at, scope, loop);
        const body = field(n, 'body')!;
        brace(body);
        statement(body, scope);
        return scope;
      }
      case 'do_statement': {
        const loop = loops++;
        edits.insert(outer.startIndex, `${T}.loop(${loop},1);`);
        const body = field(n, 'body')!;
        brace(body);
        statement(body, scope);
        const test = inner(field(n, 'condition'))!;
        condition(test, 'while', line(test), scope, loop);
        return scope;
      }
      case 'for_statement': {
        const loop = loops++;
        edits.insert(outer.startIndex, `${T}.loop(${loop},0);`);
        let s = scope;
        for (const init of n.childrenForFieldName('init')) {
          if (init?.type !== 'local_variable_declaration') continue;
          const typeNode = field(init, 'type')!;
          for (const d of init.childrenForFieldName('declarator')) {
            if (d) s = [...s, { name: field(d, 'name')!.text, type: typeOf(typeNode, d), assigned: !!field(d, 'value') }];
          }
          ternaries(init);
        }
        const test = field(n, 'condition');
        if (test) condition(test, 'for', at, s, loop);
        const update = n.childrenForFieldName('update').find(Boolean);
        if (update) edits.insert(update.startIndex, `${T}.at(${at}),`);
        for (const u of n.childrenForFieldName('update')) ternaries(u);
        const body = field(n, 'body')!;
        brace(body);
        statement(body, s);
        return scope;
      }
      case 'enhanced_for_statement': {
        const loop = loops++;
        edits.insert(outer.startIndex, `${T}.loop(${loop},0);`);
        const typeNode = field(n, 'type')!;
        const name = field(n, 'name')!;
        const s = [...scope, { name: name.text, type: typeOf(typeNode, n), assigned: true }];
        const body = field(n, 'body')!;
        brace(body);
        const inside = site(s);
        edits.insert(body.type === 'block' ? body.startIndex + 1 : body.startIndex, `${T}.each(${at},${loop},${inside.id},${inside.values});`);
        ternaries(field(n, 'value'));
        statement(body, s);
        const done = site(scope);
        edits.insert(outer.endIndex, `${T}.eachDone(${at},${loop},${done.id},${done.values});`);
        return scope;
      }
      case 'switch_expression': {
        const test = inner(field(n, 'condition'))!;
        const s = site(scope);
        edits.wrap(test.startIndex, test.endIndex, `${T}.sw(${T}.at(${at}),(`, `),${at},${s.id},${s.values})`);
        ternaries(test);
        for (const group of named(field(n, 'body'))) {
          let g = scope;
          for (const c of named(group)) if (c.type !== 'switch_label') g = statement(c, g);
        }
        return scope;
      }
      case 'try_statement':
      case 'try_with_resources_statement': {
        let s = scope;
        for (const r of named(field(n, 'resources'))) {
          if (r.type !== 'resource' || !field(r, 'name')) continue;
          s = [...s, { name: field(r, 'name')!.text, type: typeOf(field(r, 'type')!, r), assigned: true }];
          ternaries(r);
        }
        statement(field(n, 'body')!, s);
        for (const c of named(n)) {
          if (c.type === 'catch_clause') {
            const param = named(c).find((p) => p.type === 'catch_formal_parameter')!;
            const name = field(param, 'name')!.text;
            const types = named(param).find((p) => p.type === 'catch_type')!;
            const body = field(c, 'body')!;
            edits.insert(body.startIndex + 1, `${T}.caught(${name});`);
            statement(body, [...scope, { name, type: clean(types.text), assigned: true }]);
          } else if (c.type === 'finally_clause') {
            statement(named(c)[0], scope);
          }
        }
        return scope;
      }
      case 'return_statement': {
        const value = named(n)[0];
        const s = site(scope);
        if (!value) {
          edits.insert(n.startIndex, `${T}.at(${at});${T}.ret(${at},${s.id},${s.values});`);
          return scope;
        }
        edits.insert(n.startIndex, `${T}.at(${at});`);
        edits.replace(n.startIndex, value.startIndex, `{${returnType} _ot_r=(`);
        edits.replace(value.endIndex, n.endIndex, `);${T}.ret(${at},${s.id},${s.values},_ot_r);return _ot_r;}`);
        ternaries(value);
        return scope;
      }
      case 'break_statement':
      case 'continue_statement': {
        const s = site(scope);
        edits.insert(n.startIndex, `${T}.at(${at});${T}.step(${at},${s.id},${s.values});`);
        return scope;
      }
      case 'throw_statement':
        edits.insert(n.startIndex, `${T}.at(${at});`);
        ternaries(n);
        return scope;
      case 'labeled_statement': {
        const body = named(n).find((c) => c.type !== 'identifier')!;
        return statement(body, scope, label ?? n);
      }
      case 'synchronized_statement':
        return statement(field(n, 'body')!, scope);
      case 'yield_statement':
        return scope;
      default:
        if (TYPES.has(n.type) || n.type === ';' || n.type === 'empty_statement') return scope;
        fail(n, `Tracing ${n.type.replace(/_/g, ' ')} is not supported yet`);
    }
  }

  // ── Methods ──
  const methods = [...root.descendantsOfType('method_declaration'), ...root.descendantsOfType('constructor_declaration')]
    .filter((m): m is Node => !!m && !!field(m, 'body'));
  for (const m of methods) {
    const owner = classOf(m);
    if (!owner) continue;
    const ownerName = field(owner, 'name')!.text;
    const constructor = m.type === 'constructor_declaration';
    const name = constructor ? ownerName : field(m, 'name')!.text;
    const shown = constructor ? name : owner.id === entryClass.id ? name : `${ownerName}.${name}`;
    const fn = id(tables.functions, shown);
    functionClass[fn] = id(tables.classes, binary.get(owner.id)!);
    const modifiers = named(m).find((c) => c.type === 'modifiers')?.text ?? '';
    const isStatic = /\bstatic\b/.test(modifiers) || owner.type === 'interface_declaration' && !/\bdefault\b/.test(modifiers);
    returnType = constructor ? 'void' : clean(field(m, 'type')!.text + (field(m, 'dimensions')?.text ?? ''));

    const params: Local[] = [];
    if (!isStatic) params.push({ name: 'this', type: ownerName, assigned: true });
    for (const p of named(field(m, 'parameters'))) {
      if (p.type === 'formal_parameter') params.push({ name: field(p, 'name')!.text, type: typeOf(field(p, 'type')!, p), assigned: true });
      else if (p.type === 'spread_parameter') {
        const typeNode = named(p).find((c) => c.type !== 'modifiers' && c.type !== 'variable_declarator')!;
        const d = named(p).find((c) => c.type === 'variable_declarator')!;
        params.push({ name: field(d, 'name')!.text, type: `${clean(typeNode.text)}[]`, assigned: true });
      }
    }
    const body = field(m, 'body')!;
    const first = named(body)[0];
    const invocation = constructor && first?.type === 'explicit_constructor_invocation' ? first : null;
    const s = site(params);
    const end = body.endPosition.row + 1;
    edits.insert(invocation ? invocation.endIndex : body.startIndex + 1,
      `int _ot_f=${T}.enter(${fn},${line(m)},${end},${s.id},${s.values});try{`);
    edits.insert(body.endIndex - 1, `}catch(Throwable _ot_e){${T}.raise(_ot_e);throw _ot_e;}finally{${T}.leave(_ot_f,${end});}`);
    let scope = params;
    for (const c of named(body)) if (c.id !== invocation?.id) scope = statement(c, scope);
  }

  const join = (table: Map<string, number>) => [...table.keys()].join('\u0001');
  const tableText = [
    entryName,
    join(tables.names),
    join(tables.types),
    join(tables.functions),
    join(tables.classes),
    functionClass.join('\u0001'),
    [...sites.keys()].join('\u0001'),
    String(id(tables.classes, entryName)),
  ].join('\u0002');
  return { code: edits.apply(source), file, conditions, tables: tableText };
}
