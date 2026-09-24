import tracerSource from './tracer.py?raw';
import { PythonWorker, type WorkerMessage } from './worker-client.ts';
import { LRU, traceKey } from '../trace/cache.ts';
import { TraceStore } from '../trace/store.ts';
import type { TraceLimits, TraceResult, TraceStep } from '../trace/schema.ts';

/**
 * Python tracing, from the page's side.
 *
 * Where it runs: in the browser, in a Web Worker, on Pyodide — the same
 * runtime /officina already serves from this origin. Nothing is sent to a
 * server, and there is no network round-trip once the runtime is warm.
 *
 * Staying warm (build guide §27.3): a program that never yields cannot be
 * interrupted from outside a worker without SharedArrayBuffer, which this
 * site does not enable (public/_headers says why). So the
 * only real cancel is terminating the worker — and a terminated worker takes
 * Pyodide with it. To keep that off the hot path a second, already-loaded
 * worker waits as a spare once the first run starts; cancelling promotes it
 * immediately and a new spare loads in the background.
 *
 * Stale results (§27.6): every run has an id and a superseded run is
 * terminated, not ignored, so nothing from it can arrive afterwards.
 */

export const DEFAULT_LIMITS: TraceLimits = {
  max_steps: 50_000,
  max_seconds: 5,
  max_output: 256 * 1024,
  max_source: 200 * 1024,
  chunk_size: 1000,
};

/** Time allowed past max_seconds before the worker is killed from outside. */
const HARD_GRACE_MS = 2000;
/** Time for a stopped program to hand back control before it is killed. */
const STOP_GRACE_MS = 750;

export type RuntimeState = 'cold' | 'loading' | 'ready' | 'failed';

export interface TraceRequest {
  code: string;
  stdin?: string;
  limits?: Partial<TraceLimits>;
}

export interface TraceRun {
  store: TraceStore;
  /** Resolves once, when the run has ended in any way. */
  result: Promise<TraceResult>;
  cached: boolean;
  cancel(): void;
}

export interface RuntimeMetrics {
  readyMs: number | null;
  runs: { steps: number; firstChunkMs: number | null; totalMs: number; cached: boolean }[];
}

interface Active {
  runId: number;
  store: TraceStore;
  key: string;
  began: number;
  firstChunkMs: number | null;
  hardTimer: ReturnType<typeof setTimeout>;
  stopTimer: ReturnType<typeof setTimeout> | null;
  resolve(result: TraceResult): void;
}

export class PythonRuntime {
  readonly metrics: RuntimeMetrics = { readyMs: null, runs: [] };
  private readonly indexURL: string;
  private readonly keepSpare: boolean;
  private readonly debug: boolean;
  private primary: PythonWorker | null = null;
  private spare: PythonWorker | null = null;
  private active: Active | null = null;
  private nextRun = 1;
  private generation = 0;
  private cache: LRU<{ steps: TraceStep[]; result: TraceResult }>;
  private _state: RuntimeState = 'cold';
  private listeners = new Set<(s: RuntimeState) => void>();
  private createdAt = performance.now();

  constructor(options: { indexURL?: string; spare?: boolean; debug?: boolean; cacheSize?: number } = {}) {
    // A Blob worker's base URL is blob:, so the runtime's location must be absolute.
    this.indexURL = new URL(options.indexURL ?? '/pyodide/', location.href).href;
    this.keepSpare = options.spare ?? true;
    this.debug = options.debug ?? false;
    this.cache = new LRU(options.cacheSize ?? 16);
  }

  get state() {
    return this._state;
  }

  onStateChange(fn: (s: RuntimeState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(s: RuntimeState) {
    this._state = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Start loading Pyodide now, so it is ready before anyone presses Trace. */
  warm(): Promise<void> {
    if (!this.primary) {
      this.setState('loading');
      this.primary = new PythonWorker(this.indexURL, { tracer: tracerSource });
      const worker = this.primary;
      worker.ready.then(
        ({ ms }) => {
          if (this.primary !== worker) return;
          this.metrics.readyMs ??= Math.round(performance.now() - this.createdAt);
          this.log(`runtime ready: ${ms} ms in the worker, ${this.metrics.readyMs} ms after page start`);
          this.setState('ready');
        },
        () => {
          if (this.primary !== worker) return;
          this.primary = null;
          this.setState('failed');
        },
      );
    }
    return this.primary.ready.then(() => {});
  }

  async trace(request: TraceRequest): Promise<TraceRun> {
    const generation = ++this.generation;
    this.cancel();                                  // a new run supersedes the old, for real

    const limits = { ...DEFAULT_LIMITS, ...request.limits };
    const stdin = request.stdin ?? '';
    const key = await traceKey({ language: 'python', code: request.code, stdin, limits });
    const store = new TraceStore();

    const hit = this.cache.get(key);
    if (hit) {
      store.append(hit.steps);
      store.finish(hit.result);
      this.metrics.runs.push({ steps: hit.steps.length, firstChunkMs: 0, totalMs: 0, cached: true });
      return { store, result: Promise.resolve(hit.result), cached: true, cancel: () => {} };
    }
    if (generation !== this.generation) {
      const result = cancelledResult(0);
      store.finish(result);
      return { store, result: Promise.resolve(result), cached: false, cancel: () => {} };
    }

    let resolve!: (r: TraceResult) => void;
    const result = new Promise<TraceResult>((r) => { resolve = r; });
    const run = { store, result, cached: false, cancel: () => { if (this.active?.store === store) this.cancel(); } };

    try {
      await this.warm();
    } catch (err) {
      const failed = crashResult(`The Python runtime did not load: ${String((err as Error)?.message ?? err)}`);
      store.finish(failed);
      resolve(failed);
      return run;
    }
    if (generation !== this.generation) {
      const r = cancelledResult(0);
      store.finish(r);
      resolve(r);
      return run;
    }

    const worker = this.primary!;
    const runId = this.nextRun++;
    const active: Active = {
      runId, store, key,
      began: performance.now(),
      firstChunkMs: null,
      stopTimer: null,
      hardTimer: setTimeout(() => this.kill('hard-time'), limits.max_seconds * 1000 + HARD_GRACE_MS),
      resolve,
    };
    this.active = active;
    worker.onRunMessage = (m) => this.onMessage(active, m);
    worker.run(runId, request.code, stdin, limits);
    this.ensureSpare();
    return run;
  }

  /** Stop the run in progress, if any. The trace so far is kept. */
  cancel() {
    if (this.active) this.kill('cancelled');
  }

  dispose() {
    this.cancel();
    this.primary?.terminate();
    this.spare?.terminate();
    this.primary = this.spare = null;
    this.setState('cold');
  }

  private onMessage(active: Active, m: WorkerMessage) {
    if (this.active !== active || !('runId' in m) || m.runId !== active.runId) return;
    if (m.type === 'chunk') {
      active.firstChunkMs ??= performance.now() - active.began;
      active.store.append(JSON.parse(m.json) as TraceStep[]);
    } else if (m.type === 'stopped') {
      // The trace is whole. If the program swallowed the stop and is still
      // running, it will not hand control back; give it a moment, then kill it.
      const stopped = JSON.parse(m.json);
      active.stopTimer = setTimeout(() => {
        this.finish(active, {
          ...baseResult(), status: 'stopped', complete: false, steps: active.store.length,
          stdout: '', stderr: '', stopped,
        });
        this.replacePrimary();
      }, STOP_GRACE_MS);
    } else if (m.type === 'done') {
      this.finish(active, JSON.parse(m.json) as TraceResult);
    }
  }

  private finish(active: Active, result: TraceResult) {
    if (this.active !== active) return;
    clearTimeout(active.hardTimer);
    if (active.stopTimer) clearTimeout(active.stopTimer);
    this.active = null;

    const totalMs = performance.now() - active.began;
    result.timing = {
      parseMs: result.timing?.parseMs ?? 0,
      runMs: result.timing?.runMs ?? 0,
      totalMs: Math.round(totalMs),
      firstChunkMs: active.firstChunkMs === null ? undefined : Math.round(active.firstChunkMs),
    };
    active.resolve(result);
    active.store.finish(result);
    // The tracer itself failed. Whatever state broke it lives in that
    // interpreter, so the next run gets a fresh one.
    if (result.status === 'crashed') this.replacePrimary();

    this.metrics.runs.push({ steps: active.store.length, firstChunkMs: active.firstChunkMs, totalMs, cached: false });
    this.log(`trace: ${active.store.length} steps, first chunk ${active.firstChunkMs?.toFixed(0) ?? '—'} ms, total ${totalMs.toFixed(0)} ms`);

    // Only deterministic endings are worth keeping: a time limit depends on
    // the machine, and a cancelled run is not the program's trace at all.
    const deterministic =
      result.status === 'ok' || result.status === 'error' || result.status === 'syntax' ||
      (result.status === 'stopped' && (result.stopped?.reason === 'steps' || result.stopped?.reason === 'output'));
    if (deterministic) this.cache.set(active.key, { steps: active.store.steps, result });
  }

  private kill(reason: 'cancelled' | 'hard-time') {
    const active = this.active;
    if (!active) return;
    const message =
      reason === 'cancelled'
        ? 'Cancelled. The steps traced before that are shown; the trace is incomplete.'
        : 'Stopped from outside after the time limit — the program stopped responding to the tracer ' +
          '(a long call into the runtime, or code that caught the stop). The trace is incomplete.';
    this.finish(active, {
      ...baseResult(),
      status: reason === 'cancelled' ? 'cancelled' : 'stopped',
      complete: false,
      steps: active.store.length,
      stdout: '',
      stderr: '',
      stopped: { reason, message, step: active.store.length - 1 },
    });
    this.replacePrimary();
  }

  /** Throw away a busy worker and carry on with the spare. */
  private replacePrimary() {
    this.primary?.terminate();
    this.primary = this.spare;
    this.spare = null;
    if (!this.primary) {
      this.setState('cold');
      void this.warm().catch(() => {});
    } else {
      const promoted = this.primary;
      promoted.ready.then(() => { if (this.primary === promoted) this.setState('ready'); }, () => {});
      this.setState('loading');
    }
    this.ensureSpare();
  }

  private ensureSpare() {
    if (!this.keepSpare || this.spare) return;
    const start = () => {
      if (this.spare || !this.primary) return;
      this.spare = new PythonWorker(this.indexURL, { tracer: tracerSource });
      this.spare.ready.catch(() => { this.spare = null; });
    };
    // Loading a second interpreter competes with the run for the CPU, so it
    // waits until the page is idle.
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: object) => void }).requestIdleCallback;
    if (idle) idle(start, { timeout: 3000 });
    else setTimeout(start, 500);
  }

  private log(message: string) {
    if (this.debug) console.debug(`[officina] ${message}`);
  }
}

function baseResult(): Pick<TraceResult, 'schema' | 'language'> {
  return { schema: 1, language: 'python' };
}

function cancelledResult(steps: number): TraceResult {
  return {
    ...baseResult(), status: 'cancelled', complete: false, steps, stdout: '', stderr: '',
    stopped: { reason: 'cancelled', message: 'Superseded by a newer run.' },
  };
}

function crashResult(message: string): TraceResult {
  return {
    ...baseResult(), status: 'crashed', complete: false, steps: 0, stdout: '', stderr: '',
    error: { kind: 'crash', type: 'RuntimeUnavailable', message },
  };
}
