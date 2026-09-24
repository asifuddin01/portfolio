/**
 * What the tutor asks of a model, and nothing about which model answers.
 *
 * Three things are asked (README, phase 1): a step explained, a problem
 * solved, and a free question about the step in view. They differ only in
 * the prompt, so they are one call with a task tag rather than three
 * methods — a provider that gets a new task should not have to be rewritten.
 *
 * Two rules come from the schema and are enforced here rather than trusted
 * to each provider:
 *
 * - **The model never produces a trace.** It is handed facts the interpreter
 *   established and asked to put them into words. Nothing it returns is
 *   written back into a step; an `Explanation` refers to steps by number and
 *   stays beside them.
 * - **Everything streams and everything cancels.** A local model on a modest
 *   machine takes seconds; a reader who has moved to another step must not
 *   wait for an answer about the one they left.
 */
import type { StepView } from '../trace/store.ts';
import type { TraceResult } from '../trace/schema.ts';

import type { TutorTask } from './system-prompts.ts';
export type { TutorTask };

/** What the model is told about, assembled by ai/context.ts. */
export interface TutorRequest {
  task: TutorTask;
  /** The program as written. */
  source: string;
  /** The step in view. Absent for `solve`, which is asked before running. */
  step?: StepView;
  /** How the run ended, when it has. Lets an answer mention a limit or an error. */
  result?: TraceResult;
  /** The reader's own words. Required for `ask`; the problem text for `solve`. */
  question?: string;
}

/**
 * An answer, kept separate from the trace it describes.
 *
 * `steps` is how an answer points at the trace — the viewer turns those into
 * links. The model is asked for them in its prompt but they are also parsed
 * out of the prose, because a small model follows a format about as often as
 * it does not.
 */
export interface Explanation {
  task: TutorTask;
  text: string;
  /** Step indices the answer refers to, for linking back to the timeline. */
  steps: number[];
  /** True while more is still arriving. */
  streaming: boolean;
}

export type TutorChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; explanation: Explanation }
  | { type: 'error'; message: string; kind: TutorErrorKind };

export type TutorErrorKind =
  /** No WebGPU, no engine, nothing to fall back to. */
  | 'unsupported'
  /** The reader has not loaded a model yet. */
  | 'not-loaded'
  /** The download or the engine failed. */
  | 'engine'
  /** The reader cancelled, or moved on. */
  | 'cancelled';

/** Progress while a provider gets itself ready. Downloads are large. */
export interface TutorLoadProgress {
  /** 0–1 where the provider can say; otherwise absent. */
  progress?: number;
  /** The provider's own words, e.g. "Fetching param cache[12/38]". */
  text: string;
  /** True once the provider can answer. */
  ready: boolean;
}

export type TutorState = 'absent' | 'loading' | 'ready' | 'failed';

export interface TutorProvider {
  /** Shown to the reader: "Qwen2.5 Coder 3B, in this browser". */
  readonly name: string;
  /** Whether this provider could work here at all — WebGPU, a key, a network. */
  available(): Promise<boolean>;
  /** True when the weights are already on this device and loading is quick. */
  cached?(): Promise<boolean>;
  readonly state: TutorState;
  /** Get ready to answer. Safe to call twice; the second call joins the first. */
  load(onProgress?: (p: TutorLoadProgress) => void): Promise<void>;
  /**
   * Answer, a piece at a time.
   *
   * Implementations must stop promptly when `signal` aborts and must emit
   * exactly one terminal chunk (`done` or `error`) — the panel's state machine
   * relies on it.
   */
  answer(request: TutorRequest, signal: AbortSignal): AsyncIterable<TutorChunk>;
  /** Free the GPU and any worker. The page may live much longer than the panel. */
  unload(): Promise<void>;
}

/**
 * Step numbers named in prose, for linking back to the trace.
 *
 * Deliberately forgiving about how the model writes them, and deliberately
 * strict about what counts: a bare number is far more often a value from the
 * program than a step index, so the word has to be there.
 */
export function stepsNamedIn(text: string, total: number): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/\bsteps?\s*#?\s*(\d+)/gi)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n >= 0 && n < total) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}
