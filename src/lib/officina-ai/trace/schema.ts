/**
 * The trace schema: what every language adapter produces and every view reads.
 *
 * It is language-independent on purpose. Python produces it today from
 * python/tracer.py; C, C++, Java and the assembly simulator
 * will produce the same shape, with their own facts in the optional fields
 * (memory, registers, program counter). The UI never learns which language
 * it is showing except to label things.
 *
 * Two rules the schema exists to enforce:
 *
 * - **Facts only.** Every field is something an execution engine observed.
 *   An AI explanation is a separate object that may refer to steps by
 *   number; it is never merged into a step.
 * - **Structure, not text.** Steps hold values, not rendered strings, so the
 *   same trace can drive the variable table, the timeline, the editor
 *   highlight and an AI prompt without re-parsing anything.
 *
 * A step is emitted when something finishes — a line has run, a function has
 * been entered or has returned, an exception has been raised — and carries
 * what that changed. docs/trace-schema.md walks through an example.
 */

/**
 * A value as the engine saw it, encoded without running any of the
 * program's own code. Plain JSON where that is exact; tagged otherwise.
 */
export type TraceValue =
  | null
  | boolean
  | number                                            // integers within ±(2^53 − 1)
  | string                                            // strings up to 200 characters
  | { t: 'int'; r: string }                           // an integer too large for a JS number
  | { t: 'float'; r: string }                         // repr, so 3.0 stays 3.0
  | { t: 'str'; v: string; n: number }                // a long string: its start and full length
  | { t: 'list' | 'tuple' | 'set' | 'frozenset'; items: TraceValue[]; n: number; cls?: string }
  | { t: 'dict'; items: [TraceValue, TraceValue][]; n: number; cls?: string }
  | { t: 'object'; cls: string; attrs: [string, TraceValue][] }
  | { t: 'function' | 'class' | 'module'; name: string }
  | { t: 'exception'; cls: string; r: string }
  | { t: 'other'; cls: string; r: string }
  | { t: 'more'; cls: string }                        // nested too deeply to expand
  | { t: 'cycle'; cls: string };                      // refers back to a container being shown

/** `[frame, name, value]` sets a variable; `[frame, name]` removes it. */
export type Change = [fid: number, name: string, value: TraceValue] | [fid: number, name: string];

export interface ConditionOperand {
  /** The operand's source text, e.g. `s[len(s) - 1 - i]`. */
  expr: string;
  /** What it evaluated to — absent when a short-circuit skipped it. */
  value?: TraceValue;
  skipped?: true;
}

export interface Condition {
  kind: 'if' | 'while' | 'ternary';
  expr: string;
  result: boolean;
  line: number;
  operands?: ConditionOperand[];
}

export type StepEvent = 'call' | 'line' | 'return' | 'exception';

export interface TraceStep {
  step: number;
  event: StepEvent;
  /** 1-based source line. 0 for the program's own entry, which has no line. */
  line: number;
  /** The frame (one activation of a function) this step belongs to. */
  fid: number;
  function: string;
  depth: number;

  changes?: Change[];
  conditions?: Condition[];
  stdout?: string;
  stderr?: string;
  stdin?: string;
  loop?: { line: number; iteration?: number; done?: number };
  /** The line was cut off by a limit before it finished. */
  partial?: true;

  // event === 'call'
  parent?: number;
  callerLine?: number;
  args?: [string, TraceValue][];

  // event === 'return'
  returnValue?: TraceValue;
  /** Left because an exception propagated through, not by returning. */
  unwinding?: true;

  // event === 'exception'
  exception?: { type: string; message: string };
}

export interface ExecutionError {
  kind: 'syntax' | 'runtime' | 'recursion' | 'memory' | 'input' | 'crash' | 'unsupported';
  type: string;
  message: string;
  line?: number | null;
  column?: number | null;
  /** The step at which it was raised, when there is one. */
  step?: number;
}

export interface TraceResult {
  schema: number;
  language: string;
  runtime?: { implementation: string; version: string };
  status: 'ok' | 'error' | 'syntax' | 'stopped' | 'rejected' | 'crashed' | 'cancelled';
  /** False whenever steps are missing — a limit, a crash, or tracing turned off. */
  complete: boolean;
  steps: number;
  stdout: string;
  stderr: string;
  error?: ExecutionError;
  stopped?: { reason: 'steps' | 'time' | 'output' | 'hard-time' | 'cancelled'; message: string; step?: number };
  incompleteReason?: string;
  exitCode?: number;
  structure?: {
    functions: { name: string; line: number; end: number; params: string[] }[];
    classes: { name: string; line: number; end: number }[];
  };
  timing?: { parseMs: number; runMs: number; totalMs?: number; firstChunkMs?: number };
}

export interface TraceLimits {
  max_steps: number;
  max_seconds: number;
  max_output: number;
  max_source: number;
  chunk_size: number;
}
