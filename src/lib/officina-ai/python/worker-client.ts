import workerSource from './worker.js?raw';
import type { TraceLimits } from '../trace/schema.ts';

/**
 * One Python worker, seen from the page.
 *
 * Shared by /officina/ai (runtime.ts, which traces) and /officina
 * (session.ts, which runs notebook cells). Both get the same locked-down
 * worker — the network removed, results over a private MessagePort — and
 * differ only in the program they hand it.
 */

export type WorkerMessage =
  | { type: 'ready'; version: string; ms: number }
  | { type: 'fatal'; message: string }
  | { type: 'chunk'; runId: number; json: string }
  | { type: 'stopped'; runId: number; json: string }
  | { type: 'done'; runId: number; json: string }
  | { type: 'output'; runId: number; text: string }
  | { type: 'exec-done'; runId: number; outcome: string };

export class PythonWorker {
  readonly ready: Promise<{ version: string; ms: number }>;
  onRunMessage: (m: WorkerMessage) => void = () => {};
  private worker: Worker;
  private port: MessagePort;

  /**
   * `indexURL` must be absolute: a Blob worker's own base URL is blob:, so a
   * relative path would resolve against nothing.
   */
  constructor(indexURL: string, sources: { tracer?: string; notebook?: string }) {
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    this.worker = new Worker(url, { type: 'module', name: 'officina-python' });
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.ready = new Promise((resolve, reject) => {
      this.worker.onerror = (e) => reject(new Error(e.message || 'the Python worker failed to start'));
      this.port.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data;
        if (m.type === 'ready') resolve({ version: m.version, ms: m.ms });
        else if (m.type === 'fatal') reject(new Error(m.message));
        else this.onRunMessage(m);
      };
    });
    this.ready.finally(() => URL.revokeObjectURL(url)).catch(() => {});
    this.worker.postMessage(
      { type: 'init', indexURL, tracerSource: sources.tracer, notebookSource: sources.notebook },
      [channel.port2],
    );
  }

  /** Trace a program (tracer.py). */
  run(runId: number, code: string, stdin: string, limits: TraceLimits) {
    this.port.postMessage({ type: 'run', runId, code, stdin, limits });
  }

  /** Run a notebook cell (notebook.py). */
  exec(runId: number, code: string, limit: number) {
    this.port.postMessage({ type: 'exec', runId, code, limit });
  }

  terminate() {
    this.worker.terminate();
    this.port.close();
  }
}
