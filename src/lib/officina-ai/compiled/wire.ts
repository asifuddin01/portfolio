import type { ConditionMeta } from './instrument.ts';
import type { TraceStore } from '../trace/store.ts';
import type { Condition, ExecutionError, TraceLimits, TraceResult, TraceStep } from '../trace/schema.ts';

/**
 * Reading a traced C or Java program's trace as it writes it.
 *
 * trace.c and OfficinaTrace.java write one JSON object per line: a step, or,
 * last, how the run ended. A step's conditions arrive as numbers — which
 * condition, its result, the operand values — and are joined here to what
 * the instrumenter recorded of their source text. Kept apart from runtime.ts
 * so the native tests read a trace exactly as the page does.
 */

export type CompiledLanguage = 'c' | 'java';

export type Ending =
  | { kind: 'done'; code: number }
  | { kind: 'exit' }
  | { kind: 'stop'; reason: 'steps' | 'time' | 'output'; step: number }
  | { kind: 'error'; line: number; step: number };

type WireStep = TraceStep & { c?: [number, boolean, [number, unknown][]][] };

/** A condition's result and operand values, with what the page knows of its text. */
function conditionsOf(raw: WireStep['c'], meta: ConditionMeta[]): Condition[] {
  return (raw ?? []).map(([cid, result, values]) => {
    const m = meta[cid];
    const seen = new Map(values);
    return {
      kind: m.kind as Condition['kind'],
      expr: m.expr,
      result,
      line: m.line,
      ...(m.operands.length ? {
        operands: m.operands.map((expr, k) => (seen.has(k) ? { expr, value: seen.get(k) as never } : { expr, skipped: true as const })),
      } : {}),
    };
  });
}

export class WireReader {
  ending: Ending | null = null;
  junk = '';
  firstStepAt: number | null = null;
  private buffer = '';
  private readonly store: TraceStore;
  private readonly meta: ConditionMeta[];
  constructor(store: TraceStore, meta: ConditionMeta[]) {
    this.store = store;
    this.meta = meta;
  }

  push(text: string) {
    this.buffer += text;
    const batch: TraceStep[] = [];
    let end: number;
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const row = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      let event: Record<string, unknown>;
      try {
        event = row.startsWith('{') ? JSON.parse(row) : null;
      } catch {
        event = null as never;
      }
      if (!event) {
        if (row.trim()) this.junk += `${row}\n`;
        continue;
      }
      if (typeof event.step === 'number' && event.step === this.store.length + batch.length) {
        const { c, ...step } = event as unknown as WireStep;
        batch.push(c ? { ...step, conditions: conditionsOf(c, this.meta) } : step);
      } else if ('done' in event) this.ending = { kind: 'done', code: Number(event.done) };
      else if ('exit' in event) this.ending = { kind: 'exit' };
      else if ('stop' in event) this.ending = { kind: 'stop', reason: event.stop as 'steps', step: Number(event.step) };
      else if ('error' in event) {
        const e = event.error as { line: number; step: number };
        this.ending = { kind: 'error', line: e.line, step: e.step };
      }
    }
    if (batch.length) {
      this.firstStepAt ??= performance.now();
      this.store.append(batch);
    }
  }
}

const STOPPED: Record<'steps' | 'time' | 'output', (l: TraceLimits) => string> = {
  steps: (l) => `Stopped after ${l.max_steps.toLocaleString()} steps — the step limit. The trace up to that point is shown; it is incomplete.`,
  time: (l) => `Stopped after ${l.max_seconds} s — the time limit. The trace up to that point is shown; it is incomplete.`,
  output: (l) => `Stopped after ${l.max_output.toLocaleString()} characters of output — the output limit. The trace up to that point is shown; it is incomplete.`,
};

export function resultOf(language: CompiledLanguage, store: TraceStore, reader: WireReader, limits: TraceLimits,
  exitCode: number | undefined, crash: string, timing: TraceResult['timing']): TraceResult {
  const stdout = store.length ? store.at(store.length - 1).stdout : '';
  const stderr = (store.length ? store.at(store.length - 1).stderr : '') + reader.junk;
  const base = { schema: 1, language, steps: store.length, stdout, stderr, timing, ...(exitCode !== undefined ? { exitCode } : {}) };
  const ending = reader.ending;
  if (ending?.kind === 'done' || ending?.kind === 'exit') return { ...base, status: 'ok', complete: true };
  if (ending?.kind === 'stop') {
    return { ...base, status: 'stopped', complete: false, stopped: { reason: ending.reason, message: STOPPED[ending.reason](limits), step: ending.step } };
  }
  if (ending?.kind === 'error') {
    const at = store.steps[ending.step];
    const type = at?.exception?.type ?? 'Error';
    const error: ExecutionError = {
      kind: /stack ?overflow/i.test(type) ? 'recursion' : 'runtime',
      type,
      message: at?.exception?.message || type,
      line: ending.line,
      step: ending.step,
    };
    return { ...base, status: 'error', complete: true, error };
  }
  return {
    ...base, status: 'crashed', complete: false,
    error: { kind: 'crash', type: 'Crash', message: `The program stopped without finishing${crash ? `: ${crash}` : ''}. The steps recorded before it are shown.` },
  };
}

