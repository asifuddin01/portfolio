/**
 * The model's own worker.
 *
 * Generation is arithmetic on the GPU with a good deal of JavaScript around
 * it, and on the page thread that JavaScript competes with the trace viewer
 * for the same 50 ms budget every repaint has. Here it competes with nothing.
 *
 * This is a second worker, separate from the Pyodide one in
 * python/worker.js, and the separation is deliberate: the tracer's
 * worker has had its network deleted and must keep it that way. This one
 * downloads several gigabytes over the network. They must not be the same
 * worker, and nothing here may ever be imported into that one.
 */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (event: MessageEvent) => {
  handler.onmessage(event);
};
