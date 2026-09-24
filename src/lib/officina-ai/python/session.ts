import notebookSource from './notebook.py?raw';
import { PythonWorker, type WorkerMessage } from './worker-client.ts';

/**
 * The notebook's Python, from the page's side (/officina).
 *
 * Cells run one at a time in a worker, in a namespace they share, so the page
 * never freezes and a cell can always be stopped. Without SharedArrayBuffer —
 * which this site does not enable; public/_headers says why — a running
 * program cannot be interrupted from outside, so Stop and the time limit end
 * it by terminating the worker. That takes the namespace with it: earlier
 * cells' variables are gone, and the result says so (`restarted`).
 *
 * A second, already-loaded worker waits as a spare once a cell has run, so a
 * stop is recovered from at once rather than after another 13 MB start-up.
 * Nothing is loaded until warm() or run() is called: the page asks when a
 * reader picks Python or clicks into a cell, never on load.
 */

export type CellOutcome = 'ok' | 'error' | 'output-limit' | 'stopped' | 'time-limit' | 'crashed';

export interface CellResult {
  /** Everything the cell wrote, stdout and stderr in order, traceback included. */
  output: string;
  outcome: CellOutcome;
  /** Python was restarted to end the cell; earlier cells' variables are gone. */
  restarted: boolean;
}

export type SessionState = 'cold' | 'loading' | 'ready' | 'failed';

interface Active {
  runId: number;
  output: string;
  onOutput?: (output: string) => void;
  timer: ReturnType<typeof setTimeout>;
  resolve(result: CellResult): void;
}

export class PythonSession {
  readonly timeLimitMs: number;
  readonly maxOutput: number;
  version: string | null = null;
  private readonly indexURL: string;
  private primary: PythonWorker | null = null;
  private spare: PythonWorker | null = null;
  private active: Active | null = null;
  private nextRun = 1;
  private _state: SessionState = 'cold';
  private listeners = new Set<(s: SessionState) => void>();

  constructor(options: { indexURL?: string; timeLimitMs?: number; maxOutput?: number } = {}) {
    this.indexURL = new URL(options.indexURL ?? '/pyodide/', location.href).href;
    this.timeLimitMs = options.timeLimitMs ?? 30_000;
    this.maxOutput = options.maxOutput ?? 256 * 1024;
  }

  get state() {
    return this._state;
  }

  get running() {
    return this.active !== null;
  }

  onStateChange(fn: (s: SessionState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(s: SessionState) {
    this._state = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Start Python now, so it is ready before the first Run. */
  warm(): Promise<string> {
    if (!this.primary) this.adopt(new PythonWorker(this.indexURL, { notebook: notebookSource }));
    return this.primary!.ready.then(({ version }) => version);
  }

  /** Make `worker` the one cells run on, and follow its start-up. */
  private adopt(worker: PythonWorker) {
    this.primary = worker;
    this.setState('loading');
    worker.ready.then(
      ({ version }) => {
        if (this.primary !== worker) return;
        this.version = version;
        this.setState('ready');
      },
      () => {
        if (this.primary !== worker) return;
        this.primary = null;
        this.setState('failed');
      },
    );
  }

  /**
   * Run one cell. `onOutput` is called with everything written so far, as it
   * is written; the promise resolves once the cell has ended in any way.
   */
  async run(code: string, onOutput?: (output: string) => void): Promise<CellResult> {
    if (this.active) throw new Error('a cell is already running');
    await this.warm();
    const worker = this.primary!;
    const runId = this.nextRun++;
    return new Promise<CellResult>((resolve) => {
      const active: Active = {
        runId,
        output: '',
        onOutput,
        resolve,
        timer: setTimeout(() => this.kill('time-limit'), this.timeLimitMs),
      };
      this.active = active;
      worker.onRunMessage = (m) => this.onMessage(active, m);
      worker.exec(runId, code, this.maxOutput);
      this.ensureSpare();
    });
  }

  /** End the running cell. Python is restarted; the output so far is kept. */
  stop() {
    this.kill('stopped');
  }

  dispose() {
    this.stop();
    this.primary?.terminate();
    this.spare?.terminate();
    this.primary = this.spare = null;
    this.setState('cold');
  }

  private onMessage(active: Active, m: WorkerMessage) {
    if (this.active !== active || !('runId' in m) || m.runId !== active.runId) return;
    if (m.type === 'output') {
      active.output += m.text;
      active.onOutput?.(active.output);
    } else if (m.type === 'exec-done') {
      const outcome = (['ok', 'error', 'output-limit'].includes(m.outcome) ? m.outcome : 'crashed') as CellOutcome;
      this.finish(active, outcome, false);
      // The runner itself failed; whatever broke it lives in that
      // interpreter, so the next cell gets a fresh one.
      if (outcome === 'crashed') this.replacePrimary();
    }
  }

  private finish(active: Active, outcome: CellOutcome, restarted: boolean) {
    if (this.active !== active) return;
    clearTimeout(active.timer);
    this.active = null;
    active.resolve({ output: active.output, outcome, restarted });
  }

  private kill(outcome: 'stopped' | 'time-limit') {
    const active = this.active;
    if (!active) return;
    this.finish(active, outcome, true);
    this.replacePrimary();
  }

  /** Throw the busy worker away and carry on with the spare. */
  private replacePrimary() {
    this.primary?.terminate();
    this.primary = null;
    const next = this.spare ?? new PythonWorker(this.indexURL, { notebook: notebookSource });
    this.spare = null;
    this.adopt(next);
    this.ensureSpare();
  }

  private ensureSpare() {
    if (this.spare) return;
    const start = () => {
      if (this.spare || !this.primary) return;
      this.spare = new PythonWorker(this.indexURL, { notebook: notebookSource });
      this.spare.ready.catch(() => { this.spare = null; });
    };
    // A second interpreter loading competes with the cell for the CPU, so it
    // waits until the page is idle.
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: object) => void }).requestIdleCallback;
    if (idle) idle(start, { timeout: 3000 });
    else setTimeout(start, 500);
  }
}
