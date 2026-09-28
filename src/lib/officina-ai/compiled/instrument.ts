import type { Node } from 'web-tree-sitter';

/** A program the tracer cannot follow, with the line that says why. */
export class UnsupportedTrace extends Error {
  readonly line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.line = line;
  }
}

/** What the page knows about a condition; the trace sends only its result and operand values. */
export interface ConditionMeta {
  kind: 'if' | 'while' | 'for' | 'ternary';
  expr: string;
  line: number;
  operands: string[];
}

export const line = (n: Node) => n.startPosition.row + 1;
export const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
export const named = (n: Node | null | undefined): Node[] =>
  (n?.namedChildren ?? []).filter((c): c is Node => c !== null && !/comment$/.test(c.type));
export const field = (n: Node | null | undefined, name: string) => n?.childForFieldName(name) ?? null;

export function fail(node: Node, message: string): never {
  throw new UnsupportedTrace(`${message} (line ${line(node)}).`, line(node));
}

/** The first place a syntax tree says it could not parse. */
export function firstError(n: Node): Node | null {
  if (n.type === 'ERROR' || n.isMissing) return n;
  for (const c of n.children) {
    const hit = c && c.hasError ? firstError(c) : null;
    if (hit) return hit;
  }
  return null;
}

/**
 * Changes to a program's text, collected and then applied in one pass.
 *
 * Instrumentation is almost entirely insertion: text before a node and text
 * after it. Wraps nest — a condition is wrapped, and an operand inside it is
 * wrapped again — so the order of insertions that land on the same position
 * matters: openings go outer first, closings inner first. That falls out of
 * the order they were registered in, as long as a node's own wraps are
 * registered before its children's (a pre-order walk).
 *
 * Nothing here adds a newline, so every line of the program keeps its number
 * and a compiler's diagnostic still points at the line the reader wrote.
 */
interface Edit {
  at: number;
  end: number;
  text: string;
  /** At one position: wraps close, then open, then a range is replaced. */
  kind: 0 | 1 | 2;
  seq: number;
}

export class Edits {
  private list: Edit[] = [];
  private seq = 0;

  /** Text before `start` and after `end`, inside anything already wrapped around them. */
  wrap(start: number, end: number, before: string, after: string) {
    const seq = this.seq++;
    if (before) this.list.push({ at: start, end: start, text: before, kind: 1, seq });
    if (after) this.list.push({ at: end, end, text: after, kind: 0, seq });
  }

  insert(at: number, text: string) {
    this.wrap(at, at, text, '');
  }

  /** Replace a range no other edit falls inside — a keyword, a name. */
  replace(start: number, end: number, text: string) {
    this.list.push({ at: start, end, text, kind: 2, seq: this.seq++ });
  }

  apply(source: string): string {
    const edits = [...this.list].sort((a, b) =>
      a.at - b.at || a.kind - b.kind || (a.kind === 0 ? b.seq - a.seq : a.seq - b.seq));
    let out = '';
    let last = 0;
    for (const e of edits) {
      if (e.at < last) throw new Error('overlapping edits');
      out += source.slice(last, e.at) + e.text;
      last = e.end;
    }
    return out + source.slice(last);
  }
}
