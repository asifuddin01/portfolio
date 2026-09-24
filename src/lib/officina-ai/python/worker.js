/**
 * The Python worker, for both pages that run Python.
 *
 * Runs Pyodide off the main thread, so a program that loops forever freezes
 * this worker and not the page. /officina/ai sends it tracer.py and asks it to
 * trace (`run`); /officina sends it notebook.py and asks it to run cells
 * (`exec`). worker-client.ts starts it from a Blob as a module worker, which
 * is why this file has no static imports: the page hands it everything it
 * needs in the first message, and Pyodide is imported from the URL it names.
 *
 * What the reader's program can reach from in here is cut down before any of
 * it runs:
 *
 * - Results go back over a MessagePort held only in this closure. The
 *   worker's own postMessage is deleted, so a program cannot `import js` and
 *   post a forged trace to the page.
 * - Everything that can make a network request is deleted once Pyodide has
 *   loaded — fetch, XMLHttpRequest, WebSocket and the rest. Without that,
 *   `js.fetch` would send requests carrying this site's cookies, which on
 *   asifuddin.com include the private archive's. One way out is left that
 *   script cannot remove: `import()` is syntax, not a global, so code run
 *   through `js.eval` could still request a URL (though not read a
 *   same-origin response). A Content-Security-Policy on the deployed page
 *   closes that; ../README.md (Security) has the header.
 * - Pyodide's file system is in memory and belongs to this worker alone.
 *
 * What it cannot do is stop a program that never returns control; only
 * terminating the worker does that, and runtime.ts does.
 */
(() => {
  let port = null;
  let runJson = null;
  let runCell = null;

  const post = (message) => port.postMessage(message);

  /** Remove every way user code could reach the network or post as us. */
  function lockDown() {
    const names = [
      'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource',
      'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker',
      'FontFace', 'fonts', 'Request', 'fetchLater', 'postMessage', 'close',
    ];
    const holders = [self];
    for (let p = Object.getPrototypeOf(self); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      holders.push(p);
    }
    for (const holder of holders) {
      for (const name of names) {
        if (!Object.prototype.hasOwnProperty.call(holder, name)) continue;
        try {
          delete holder[name];
        } catch {
          // Not configurable: shadow it on the instance instead.
        }
        if (name in self) {
          try {
            Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
          } catch { /* nothing more can be done from script */ }
        }
      }
    }
  }

  async function init({ indexURL, tracerSource, notebookSource }) {
    const began = performance.now();
    // A module worker: Pyodide 314 refuses to start in a classic one.
    const { loadPyodide } = await import(indexURL + 'pyodide.mjs');
    const pyodide = await loadPyodide({
      indexURL,
      // The program's output is captured by tracer.py; nothing should reach
      // the console, where it would look like the page's own logging.
      stdout: () => {},
      stderr: () => {},
    });
    // A worker has no keyboard: input() reads end-of-file rather than
    // waiting for a prompt that can never appear. (The tracer feeds its own
    // stdin, from the tutor's Input box.)
    pyodide.setStdin({ stdin: () => null });
    // Each program lives in a private namespace, not sys.modules, so a
    // reader's `import` finds nothing of ours to patch. The notebook's is
    // given its own filename so its frames are never mistaken for the
    // reader's `<exec>` ones when a traceback is tidied.
    if (tracerSource) {
      const scope = pyodide.globals.get('dict')();
      pyodide.runPython(tracerSource, { globals: scope });
      runJson = scope.get('run_json');
    }
    if (notebookSource) {
      const scope = pyodide.globals.get('dict')();
      pyodide.runPython(notebookSource, { globals: scope, filename: '<officina-notebook>' });
      runCell = scope.get('run_cell');
    }
    const version = pyodide.runPython('import sys; ".".join(map(str, sys.version_info[:3]))');
    lockDown();
    post({ type: 'ready', version, ms: Math.round(performance.now() - began) });
  }

  /** Trace a program for /officina/ai. */
  function run({ runId, code, stdin, limits }) {
    const onChunk = (json) => post({ type: 'chunk', runId, json });
    const onStop = (json) => post({ type: 'stopped', runId, json });
    let json;
    try {
      json = runJson(code, stdin, JSON.stringify(limits), onChunk, onStop, true);
    } catch (err) {
      json = JSON.stringify({
        schema: 1, language: 'python', status: 'crashed', complete: false, steps: 0,
        stdout: '', stderr: '',
        error: { kind: 'crash', type: 'InternalError', message: String(err && err.message || err) },
      });
    }
    post({ type: 'done', runId, json });
  }

  /** Run one notebook cell for /officina, in the namespace earlier cells left. */
  async function exec({ runId, code, limit }) {
    const send = (text) => post({ type: 'output', runId, text });
    let outcome;
    try {
      outcome = String(await runCell(code, limit, send));
    } catch (err) {
      send(`\n${String((err && err.message) || err)}\n`);
      outcome = 'crashed';
    }
    post({ type: 'exec-done', runId, outcome });
  }

  self.onmessage = (event) => {
    if (!event.data || event.data.type !== 'init' || port) return;
    port = event.ports[0];
    self.onmessage = null;
    port.onmessage = (e) => {
      if (!e.data) return;
      if (e.data.type === 'run' && runJson) run(e.data);
      else if (e.data.type === 'exec' && runCell) exec(e.data);
    };
    init(event.data).catch((err) => post({ type: 'fatal', message: String(err && err.message || err) }));
  };
})();
