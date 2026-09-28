import type { Node } from 'web-tree-sitter';
import { Edits, UnsupportedTrace, clean, fail, field, firstError, line, named, type ConditionMeta } from './instrument.ts';

/**
 * C instrumentation: the reader's program, with calls into trace.c added.
 *
 * Every statement gets `_ot_at(line)` before it — so a call made from it
 * knows its caller's line — and `_ot_step(line)` after it. Each declaration
 * registers its variables with trace.c (by address), and each block releases
 * them as it ends, however it ends: a `cleanup` attribute runs on break,
 * continue and return alike. Every test of an if, loop or `?:` is wrapped so
 * its result and operands are recorded as the program computes them, once.
 *
 * The program's own code is never removed or reordered; only `main` is
 * renamed, so trace.c's main can run it between the first and last steps.
 */

export interface Instrumented {
  code: string;
  conditions: ConditionMeta[];
}

const cstr = (s: string) => JSON.stringify(s);
const LITERALS = new Set(['number_literal', 'char_literal', 'string_literal', 'concatenated_string', 'true', 'false', 'null']);
const PREPROC = new Set(['preproc_if', 'preproc_ifdef', 'preproc_else', 'preproc_elif', 'preproc_elifdef']);
/* Places an expression is not evaluated, or must stay a constant. */
const UNEVALUATED = new Set(['sizeof_expression', 'alignof_expression', 'offsetof_expression', 'generic_expression', 'case_statement', 'array_declarator', 'bitfield_clause', 'enumerator', 'static_assert_declaration']);

/**
 * The identifier a declarator declares, and the declarators around it,
 * nearest first: `*a[3]` is an array (of pointers), `(*p)[3]` a pointer.
 */
function unwrap(declarator: Node): { name: Node | null; chain: Node[] } {
  const chain: Node[] = [];
  let n: Node | null = declarator;
  while (n && n.type !== 'identifier' && n.type !== 'field_identifier') {
    chain.unshift(n);
    n = n.type === 'parenthesized_declarator' ? named(n)[0] ?? null : field(n, 'declarator');
  }
  return { name: n, chain };
}
const dimensions = (chain: Node[]) => {
  let dims = 0;
  while (chain[dims]?.type === 'array_declarator') dims++;
  return dims;
};
const indirect = (chain: Node[]) => chain.some((c) => c.type === 'pointer_declarator' || c.type === 'function_declarator');
const declared = (d: Node) => (d.type === 'init_declarator' ? field(d, 'declarator')! : d);


export function instrumentC(root: Node, source: string): Instrumented {
  if (root.hasError) fail(firstError(root) ?? root, 'This does not parse as C');
  const reserved = /\b_ot_\w*/.exec(source);
  if (reserved) throw new UnsupportedTrace(`Names beginning with _ot_ are the tracer's own; rename ${reserved[0]}.`);
  for (const [type, message] of [
    ['goto_statement', 'goto is not supported by the tracer yet'],
    ['gnu_asm_expression', 'Inline assembly cannot be traced'],
  ] as const) {
    const n = root.descendantsOfType(type)[0];
    if (n) fail(n, message);
  }
  for (const id of root.descendantsOfType('identifier')) {
    if (id && /^(setjmp|longjmp|_setjmp|sigsetjmp|siglongjmp)$/.test(id.text)) fail(id, `${id.text} cannot be traced: it jumps past the tracer's bookkeeping`);
  }

  const edits = new Edits();
  const conditions: ConditionMeta[] = [];
  const names = new Map<string, number>();
  const types = new Map<string, number>();
  const functions = new Map<string, number>();
  const id = (table: Map<string, number>, key: string) => {
    if (!table.has(key)) table.set(key, table.size);
    return table.get(key)!;
  };
  let counter = 0;

  // Variables whose address is taken anywhere: a callee may change them.
  const addressed = new Set<string>();
  for (const p of root.descendantsOfType('pointer_expression')) {
    if (!p || p.child(0)?.type !== '&') continue;
    let a = field(p, 'argument');
    while (a && ['subscript_expression', 'field_expression', 'parenthesized_expression'].includes(a.type)) {
      a = a.type === 'parenthesized_expression' ? named(a)[0] ?? null : field(a, a.type === 'subscript_expression' ? 'argument' : 'argument');
    }
    if (a?.type === 'identifier') addressed.add(a.text);
  }

  // ── Structs and enums: a function that writes each one's fields ──
  const dumps = new Map<string, string>();       // `struct P`, `enum C` or a typedef name → dumper
  const aliases = new Map<string, string>();     // typedef name → what it names
  let tail = '';
  const topLevel: Node[] = [];
  const collect = (n: Node) => {
    for (const c of named(n)) (PREPROC.has(c.type) ? collect(c) : topLevel.push(c));
  };
  collect(root);

  const tagOf = (spec: Node | null): string | null => {
    if (!spec) return null;
    if (spec.type === 'struct_specifier' || spec.type === 'enum_specifier') {
      const name = field(spec, 'name');
      return name ? `${spec.type === 'struct_specifier' ? 'struct' : 'enum'} ${name.text}` : null;
    }
    if (spec.type === 'type_identifier') return spec.text;
    return null;
  };
  const dumpOf = (spec: Node | null): string | null => {
    let key = tagOf(spec);
    for (let hops = 0; key && hops < 8; hops++) {
      if (dumps.has(key)) return dumps.get(key)!;
      key = aliases.get(key) ?? null;
    }
    return null;
  };

  function structDumper(spec: Node, typeName: string, display: string): string {
    const fn = `_ot_dump_${counter++}`;
    const parts: string[] = [];
    for (const decl of named(field(spec, 'body'))) {
      if (decl.type !== 'field_declaration') continue;
      const bitfield = decl.namedChildren.some((c) => c?.type === 'bitfield_clause');
      for (const d of decl.childrenForFieldName('declarator')) {
        if (!d) continue;
        const { name, chain } = unwrap(d);
        if (!name) continue;
        const f = name.text;
        const dims = dimensions(chain);
        const inner = indirect(chain) ? null : dumpOf(field(decl, 'type'));
        if (bitfield) parts.push(`{long long _ot_b=_ot_p->${f};_ot_field(${cstr(f)},&_ot_b,_OT_INT,8,0,0,0);}`);
        else if (dims === 0) parts.push(`_OT_FIELD0(_ot_p,${f},${inner ?? 0});`);
        else if (chain.slice(0, dims).some((a) => !field(a, 'size'))) continue;   // a flexible array member has no size to read
        else if (dims === 1) parts.push(`_OT_FIELD1(_ot_p,${f},${inner ?? 0});`);
        else parts.push(`_ot_field(${cstr(f)},&_ot_p->${f},_OT_OTHER,(int)sizeof(_ot_p->${f}),0,0,0);`);
      }
    }
    return `static void ${fn}(const void *_ot_v){const ${typeName} *_ot_p=_ot_v;_ot_object(${cstr(display)});${parts.join('')}_ot_end_object();}`;
  }

  function enumDumper(spec: Node, typeName: string): string {
    const fn = `_ot_dump_${counter++}`;
    const members = named(field(spec, 'body')).filter((e) => e.type === 'enumerator').map((e) => field(e, 'name')!.text);
    const pick = members.map((m) => `_ot_x==${m}?${cstr(m)}:`).join('');
    return `static void ${fn}(const void *_ot_v){long long _ot_x=*(const ${typeName} *)_ot_v;_ot_enum(${pick}0,_ot_x);}`;
  }

  for (const node of topLevel) {
    const specs: Node[] = [];
    const typeNode = field(node, 'type');
    if (['struct_specifier', 'enum_specifier'].includes(node.type)) specs.push(node);
    else if (typeNode && ['struct_specifier', 'enum_specifier'].includes(typeNode.type)) specs.push(typeNode);
    let code = '';
    for (const spec of specs) {
      if (!field(spec, 'body')) continue;
      const tag = tagOf(spec);
      const typedefs = node.type === 'type_definition'
        ? node.childrenForFieldName('declarator').filter((d): d is Node => d?.type === 'type_identifier').map((d) => d.text)
        : [];
      const typeName = tag ?? typedefs[0];
      if (!typeName) continue;
      const display = field(spec, 'name')?.text ?? typedefs[0];
      const text = spec.type === 'struct_specifier' ? structDumper(spec, typeName, display) : enumDumper(spec, typeName);
      const fn = /static void (_ot_dump_\d+)/.exec(text)![1];
      if (tag) dumps.set(tag, fn);
      for (const t of typedefs) dumps.set(t, fn);
      code += text;
    }
    if (node.type === 'type_definition') {
      const target = tagOf(typeNode);
      for (const d of node.childrenForFieldName('declarator')) {
        if (d?.type === 'type_identifier' && target && !dumps.has(d.text)) aliases.set(d.text, target);
      }
    }
    if (code) {
      // After the declaration's semicolon, which a bare `struct S {…};` leaves outside its node.
      let end = node.endIndex;
      const next = node.nextSibling;
      if (next && next.type === ';') end = next.endIndex;
      edits.insert(end, code);
    }
  }

  // ── Variables ──
  const typeText = (decl: Node, declarator: Node, name: Node, parameter: boolean): string => {
    const base = decl.namedChildren
      .filter((c): c is Node => c !== null && (c.type === 'type_qualifier' || c.id === field(decl, 'type')?.id))
      .map((c) => c.text)
      .join(' ');
    let rest = declarator.text.slice(0, name.startIndex - declarator.startIndex) + declarator.text.slice(name.endIndex - declarator.startIndex);
    rest = clean(rest).replace(/\s*\[\s*/g, '[').replace(/\s*\]/g, ']');
    if (parameter && rest.startsWith('[')) rest = rest.replace(/^\[[^\]]*\]/, rest.indexOf('[', 1) > 0 ? '(*)' : '*');
    return clean(!rest ? base : rest.startsWith('[') ? base + rest : `${base} ${rest}`);
  };

  /** The call that registers one declared variable, or '' when it is not one. */
  function bind(decl: Node, declarator: Node, options: { fresh: boolean; parameter?: boolean }): string {
    const target = declared(declarator);
    const { name, chain } = unwrap(target);
    if (!name || name.type !== 'identifier' || chain[0]?.type === 'function_declarator') return '';
    const dims = options.parameter ? 0 : dimensions(chain);
    const pointer = indirect(chain) || (!!options.parameter && dimensions(chain) > 0);
    const dump = pointer ? null : dumpOf(field(decl, 'type'));
    const x = name.text;
    const flags = (options.fresh && declarator.type !== 'init_declarator' ? 2 : 0)
      | (dims || dump || pointer || addressed.has(x) ? 1 : 0);
    const n = id(names, x);
    const t = id(types, typeText(decl, target, name, !!options.parameter));
    if (dims > 2) return `_ot_bind(${n},${t},&(${x}),_OT_OTHER,(int)sizeof(${x}),0,0,${flags},0);`;
    return `_OT_BIND${dims}(${n},${t},${x},${flags},${dump ?? 0});`;
  }

  const storage = (decl: Node) => decl.namedChildren.filter((c) => c?.type === 'storage_class_specifier').map((c) => c!.text);

  function bindDeclaration(decl: Node, local: boolean): string {
    const classes = storage(decl);
    if (classes.includes('extern') || classes.includes('register') || classes.includes('typedef')) return '';
    return decl.childrenForFieldName('declarator')
      .filter((d): d is Node => d !== null)
      .map((d) => bind(decl, d, { fresh: local && !classes.includes('static') }))
      .join('');
  }

  // ── Conditions ──
  function operandsOf(expr: Node, cid: number, operands: string[]) {
    const operand = (e: Node | null) => {
      if (!e || LITERALS.has(e.type) || (e.type === 'identifier' && e.text === 'NULL')) return;
      const k = operands.length;
      operands.push(clean(e.text));
      edits.wrap(e.startIndex, e.endIndex, `_OT_V(${cid},${k},`, ')');
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
      if (e.type === 'unary_expression' && field(e, 'operator')?.type === '!') return walk(field(e, 'argument'));
      if (['identifier', 'field_expression', 'subscript_expression'].includes(e.type)) operand(e);
    };
    walk(expr);
  }

  function condition(expr: Node, kind: ConditionMeta['kind'], at: number, iterations: string | null, before = '') {
    const cid = conditions.length;
    const operands: string[] = [];
    conditions.push({ kind, expr: clean(expr.text), line: at, operands });
    const step = kind === 'ternary' ? 0 : at;
    edits.wrap(expr.startIndex, expr.endIndex,
      `(${kind === 'ternary' ? '' : `_ot_at(${at}),`}${before}_ot_cond(${cid},${step},!!(`,
      `),${iterations ? `&${iterations}` : '0'}))`);
    operandsOf(expr, cid, operands);
    ternaries(expr);
  }

  /** Every `?:` evaluated inside `node`, outside unevaluated and constant places. */
  function ternaries(node: Node | null) {
    if (!node) return;
    const visit = (n: Node) => {
      if (UNEVALUATED.has(n.type)) return;
      if (n.type === 'conditional_expression') {
        const test = field(n, 'condition')!;
        condition(test, 'ternary', line(n), null);
        for (const part of [field(n, 'consequence'), field(n, 'alternative')]) if (part) visit(part);
        return;
      }
      for (const c of named(n)) visit(c);
    };
    visit(node);
  }

  // ── Statements ──
  let returnType = '__auto_type';
  let returnDump: string | null = null;

  const brace = (n: Node) => {
    if (n.type !== 'compound_statement') edits.wrap(n.startIndex, n.endIndex, '{', '}');
  };
  const declares = (n: Node) => named(n).some((c) => c.type === 'declaration'
    || (c.type === 'case_statement' && named(c).some((s) => s.type === 'declaration')));
  const mark = () => `int _ot_s${counter++} __attribute__((cleanup(_ot_pop)))=_ot_mark();`;

  function statement(n: Node) {
    const at = line(n);
    switch (n.type) {
      case 'compound_statement':
        if (declares(n)) edits.insert(n.startIndex + 1, mark());
        for (const c of named(n)) statement(c);
        return;
      case 'declaration': {
        const classes = storage(n);
        const prototypes = n.childrenForFieldName('declarator').every((d) => d && unwrap(declared(d)).chain[0]?.type === 'function_declarator');
        if (classes.includes('extern') || prototypes) return;
        const binds = bindDeclaration(n, true);
        edits.wrap(n.startIndex, n.endIndex, `_ot_at(${at});`, `${binds}_ot_step(${at});`);
        if (!classes.includes('static')) ternaries(n);
        return;
      }
      case 'expression_statement':
        if (!named(n).length) return;             // a lone `;`
        edits.wrap(n.startIndex, n.endIndex, `_ot_at(${at});`, `_ot_step(${at});`);
        ternaries(n);
        return;
      case 'if_statement': {
        condition(named(field(n, 'condition'))[0], 'if', at, null);
        const yes = field(n, 'consequence')!;
        brace(yes);
        statement(yes);
        const no = named(field(n, 'alternative'))[0];
        if (no) { brace(no); statement(no); }
        return;
      }
      case 'while_statement': {
        const k = `_ot_i${counter++}`;
        edits.wrap(n.startIndex, n.endIndex, `{int ${k}=0;`, '}');
        condition(named(field(n, 'condition'))[0], 'while', at, k);
        const body = field(n, 'body')!;
        brace(body);
        statement(body);
        return;
      }
      case 'do_statement': {
        const k = `_ot_i${counter++}`;
        edits.wrap(n.startIndex, n.endIndex, `{int ${k}=1;`, '}');
        const body = field(n, 'body')!;
        brace(body);
        statement(body);
        const test = named(field(n, 'condition'))[0];
        condition(test, 'while', line(test), k);
        return;
      }
      case 'for_statement': {
        const k = `_ot_i${counter++}`;
        const init = field(n, 'initializer');
        const binds = init?.type === 'declaration' ? bindDeclaration(init, true).replace(/;(?=.)/g, ',').replace(/;$/, '') : '';
        edits.wrap(n.startIndex, n.endIndex, `{${binds ? mark() : ''}int ${k}=0;`, '}');
        if (init) ternaries(init);
        const test = field(n, 'condition');
        if (test) condition(test, 'for', at, k, binds ? `${binds},` : '');
        const update = field(n, 'update');
        if (update) {
          edits.wrap(update.startIndex, update.endIndex, `(_ot_at(${at}),`, ')');
          ternaries(update);
        }
        const body = field(n, 'body')!;
        brace(body);
        if (!test && binds) edits.insert(body.type === 'compound_statement' ? body.startIndex + 1 : body.startIndex, `${binds};`);
        statement(body);
        return;
      }
      case 'switch_statement': {
        const body = field(n, 'body')!;
        if (declares(body)) edits.wrap(n.startIndex, n.endIndex, `{${mark()}`, '}');
        const test = named(field(n, 'condition'))[0];
        edits.wrap(test.startIndex, test.endIndex, `(_ot_at(${at}),({__auto_type _ot_x=(`, `);_ot_step(${at});_ot_x;}))`);
        ternaries(test);
        for (const c of named(body)) statement(c);
        return;
      }
      case 'case_statement':
        for (const c of named(n)) if (c.id !== field(n, 'value')?.id) statement(c);
        return;
      case 'labeled_statement':
        for (const c of named(n)) if (c.type !== 'statement_identifier') statement(c);
        return;
      case 'return_statement': {
        const value = named(n)[0];
        if (!value) {
          edits.insert(n.startIndex, `_ot_at(${at});_ot_step(${at});_ot_ret_void(${at});`);
          return;
        }
        edits.insert(n.startIndex, `_ot_at(${at});`);
        if (returnType === 'void') edits.wrap(value.startIndex, value.endIndex, '({(', `);_ot_step(${at});_ot_ret_void(${at});})`);
        else edits.wrap(value.startIndex, value.endIndex, `({${returnType} _ot_r=(`,
          `);_ot_step(${at});_OT_RET(${at},_ot_r,${returnDump ?? 0});_ot_r;})`);
        ternaries(value);
        return;
      }
      case 'break_statement':
      case 'continue_statement':
        edits.insert(n.startIndex, `_ot_at(${at});_ot_step(${at});`);
        return;
      case 'type_definition':
      case 'struct_specifier':
      case 'enum_specifier':
      case 'union_specifier':
      case 'preproc_include':
      case 'preproc_def':
      case 'preproc_function_def':
      case 'preproc_call':
        return;
      case 'attributed_statement':
        for (const c of named(n)) if (c.type !== 'attribute_declaration') statement(c);
        return;
      default:
        if (PREPROC.has(n.type)) {
          for (const c of named(n)) if (c.id !== field(n, 'condition')?.id && c.type !== 'identifier') statement(c);
          return;
        }
        fail(n, `Tracing ${n.type.replace(/_/g, ' ')} is not supported yet`);
    }
  }

  // ── Functions ──
  let main: { params: number } | null = null;
  for (const fn of root.descendantsOfType('function_definition')) {
    if (!fn) continue;
    const body = field(fn, 'body');
    if (!body) continue;
    let d = field(fn, 'declarator');
    let pointers = 0;
    let simple = true;
    while (d && d.type !== 'function_declarator') {
      if (d.type === 'pointer_declarator') pointers++;
      else simple = false;
      d = field(d, 'declarator');
    }
    if (!d) continue;
    const ident = field(d, 'declarator');
    if (!ident || ident.type !== 'identifier') fail(fn, 'This function declaration cannot be traced');
    const name = ident.text;
    const typeNode = field(fn, 'type')!;
    const base = fn.namedChildren
      .filter((c): c is Node => c !== null && (c.type === 'type_qualifier' || c.id === typeNode.id))
      .map((c) => c.text).join(' ');
    // A type that defines a struct as it goes cannot be written twice.
    if (field(typeNode, 'body')) simple = false;
    returnType = !simple ? '__auto_type' : `${base}${pointers ? ' ' + '*'.repeat(pointers) : ''}`;
    returnDump = pointers || !simple ? null : dumpOf(typeNode);
    const params = named(field(d, 'parameters')).filter((p) => p.type === 'parameter_declaration' && field(p, 'declarator'));
    const binds = params.map((p) => bind(p, field(p, 'declarator')!, { fresh: false, parameter: true })).join('');
    const fid = id(functions, name);
    edits.insert(body.startIndex + 1,
      `int _ot_f __attribute__((cleanup(_ot_leave)))=_ot_enter(${fid},${line(fn)},${body.endPosition.row + 1});${binds}_ot_call();`);
    for (const c of named(body)) statement(c);
    if (name === 'main') {
      if (main) fail(fn, 'A program has one main');
      if (base !== 'int' || pointers) fail(fn, 'main must return int');
      if (![0, 2].includes(params.length)) fail(fn, 'Use int main(void) or int main(int argc, char *argv[])');
      main = { params: params.length };
      edits.replace(ident.startIndex, ident.endIndex, '_ot_user_main');
      edits.insert(body.endIndex - 1, `{int _ot_zero=0;_OT_RET(${body.endPosition.row + 1},_ot_zero,0);return 0;}`);
    }
  }
  if (!main) throw new UnsupportedTrace('There is no main function to start from.');

  // ── Globals, and the tables trace.c reads names from ──
  const globals = topLevel
    .filter((n) => n.type === 'declaration')
    .map((n) => bindDeclaration(n, false))
    .join('');
  const list = (table: Map<string, number>) => `{${[...table.keys(), ''].map(cstr).join(',')}}`;
  tail += '\nconst char *const _ot_names[]=' + list(names) + ';' +
    '\nconst char *const _ot_types[]=' + list(types) + ';' +
    '\nconst char *const _ot_functions[]=' + list(functions) + ';' +
    `\nvoid _ot_globals(void){${globals}}` +
    `\nint _ot_program(void){${(main as { params: number }).params ? 'static char *_ot_argv[]={"program",0};return _ot_user_main(1,_ot_argv);' : 'return _ot_user_main();'}}\n`;

  return { code: edits.apply(source) + tail, conditions };
}
