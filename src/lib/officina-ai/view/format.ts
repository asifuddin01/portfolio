import type { TraceValue } from '../trace/schema.ts';

/**
 * Render a traced value the way Python would print it: `'madam'`, `3.0`,
 * `[1, 2, 3]`, `None`. The engine recorded the value structurally; this is
 * only its spelling, so the same step can be shown here and quoted exactly in
 * an AI prompt.
 */
export function formatValue(v: TraceValue, room = 120): string {
  const text = spell(v);
  return text.length <= room ? text : text.slice(0, room - 1) + '…';
}

function quote(s: string): string {
  // Python's own choice: single quotes unless the text has one and no double.
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  const body = s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
    .replace(new RegExp(q, 'g'), '\\' + q);
  return q + body + q;
}

function spell(v: TraceValue): string {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return quote(v);

  switch (v.t) {
    case 'int':
    case 'float':
      return v.r;
    case 'str':
      return `${quote(v.v)}… (${v.n.toLocaleString()} chars)`;
    case 'list':
    case 'tuple':
    case 'set':
    case 'frozenset': {
      const parts = v.items.map(spell);
      if (v.n > v.items.length) parts.push(`… ${(v.n - v.items.length).toLocaleString()} more`);
      const inner = parts.join(', ');
      const body =
        v.t === 'list' ? `[${inner}]`
        : v.t === 'tuple' ? (v.n === 1 ? `(${inner},)` : `(${inner})`)
        : v.n === 0 ? `${v.t}()`
        : v.t === 'set' ? `{${inner}}` : `frozenset({${inner}})`;
      return v.cls ? `${v.cls}(${body})` : body;
    }
    case 'dict': {
      const parts = v.items.map(([k, val]) => `${spell(k)}: ${spell(val)}`);
      if (v.n > v.items.length) parts.push(`… ${(v.n - v.items.length).toLocaleString()} more`);
      const body = `{${parts.join(', ')}}`;
      return v.cls ? `${v.cls}(${body})` : body;
    }
    case 'object':
      return `${v.cls}(${v.attrs.map(([k, val]) => `${k}=${spell(val)}`).join(', ')})`;
    case 'function':
      return `<function ${v.name}>`;
    case 'class':
      return `<class ${v.name}>`;
    case 'module':
      return `<module ${v.name}>`;
    case 'exception':
      return `${v.cls}(${v.r ? quote(v.r) : ''})`;
    case 'other':
      return v.r;
    case 'more':
      return `<${v.cls} …>`;
    case 'cycle':
      return v.cls === 'dict' ? '{...}' : '[...]';
  }
}

/** A short type label for the variable table. */
export function typeOf(v: TraceValue): string {
  if (v === null) return 'None';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return 'int';
  if (typeof v === 'string') return 'str';
  switch (v.t) {
    case 'object':
    case 'other':
    case 'exception':
    case 'more':
    case 'cycle':
      return v.cls;
    case 'function':
    case 'class':
    case 'module':
      return v.t;
    case 'str':
      return 'str';
    default:
      return 'cls' in v && v.cls ? v.cls : v.t;
  }
}

/** Functions, classes and modules: definitions rather than data. */
export function isDefinition(v: TraceValue): boolean {
  return typeof v === 'object' && v !== null && (v.t === 'function' || v.t === 'class' || v.t === 'module');
}

/**
 * Which elements of a sequence changed, when a list was mutated in place.
 * Only for same-kind sequences of the same visible length; anything else is
 * shown as a whole-value change, which is what it was.
 */
export function changedIndices(before: TraceValue | undefined, after: TraceValue | undefined): number[] | null {
  if (!isSeq(before) || !isSeq(after) || before.t !== after.t) return null;
  if (before.items.length !== after.items.length || before.n !== after.n) return null;
  const out: number[] = [];
  for (let i = 0; i < after.items.length; i++) {
    if (JSON.stringify(before.items[i]) !== JSON.stringify(after.items[i])) out.push(i);
  }
  return out;
}

type Sequence = Extract<TraceValue, { items: TraceValue[] }>;

function isSeq(v: TraceValue | undefined): v is Sequence {
  return typeof v === 'object' && v !== null && (v.t === 'list' || v.t === 'tuple');
}
