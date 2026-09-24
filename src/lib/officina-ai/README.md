# Officina AI

The engine behind [/officina/ai](../../pages/officina/ai.astro): write a
Python program, trace it, step through what it did. The page is reached from
the button in the Officina header — deliberately not from the notebook's
toolbar, which acts on cells.

> The computer executes. The AI explains. The learner understands.

The trace comes from the interpreter, never from a model. A language model
may later explain a trace; it will not write one.

## Layout

```
python/tracer.py     runs a program under sys.settrace and records what finished at each step
python/worker.js     Pyodide + tracer in a module worker, with the network removed
python/runtime.ts    worker lifecycle, a pre-loaded spare, limits, real cancellation, cache
trace/schema.ts      the step format — language-independent, facts only
trace/store.ts       holds a trace; the state at any step, checkpointed every 256 steps
trace/cache.ts       traces keyed by a hash of everything that determines them
view/trace-view.ts   the viewer; every navigation is a read from the store
view/format.ts       values spelled as Python prints them
view/highlight.ts    minimal Python highlighting
tests/               the tracer on CPython 3.14, the store, the formatter, Pyodide parity
```

The examples are the `recipes` collection's Python entries — the notebook's —
editable from /admin as "Officina examples". The `Tracing` group opens first;
an example's optional `stdin` fills the Input box.

## A step

A step is emitted when something *finishes*: a line has run, a function has
been entered or has returned, an exception has been raised. For

```python
s = "madam"
i = 0
if s[i] != s[len(s) - 1 - i]:
    print("no")
```

step 3 is line 3 after it ran:

```json
{"step": 3, "event": "line", "line": 3, "fid": 0, "function": "<module>", "depth": 0,
 "conditions": [{"kind": "if", "expr": "s[i] != s[len(s) - 1 - i]", "result": false, "line": 3,
   "operands": [{"expr": "s[i]", "value": "m"}, {"expr": "s[len(s) - 1 - i]", "value": "m"}]}]}
```

Line 4 never ran, so no step mentions it. Conditions are captured by wrapping
each test so its operands are recorded as the program computes them —
nothing is evaluated twice. `changes` may name other frames: a callee
mutating its caller's list changes the caller's variable, in the step where
it happened. Values are encoded without calling any of the program's code
(no user `__repr__`); `3.0` stays a float, long lists keep their true length.
The full format is in `trace/schema.ts`.

## Speed

Measured on an Apple M1 in Chromium, against the build guide's budgets:

| | measured | budget |
|---|---|---|
| Python ready after page start (warm cache) | 1.2 s | before first Run |
| 5,441-step program traced (Node, Pyodide) | ~200 ms | < 500 ms |
| 50,000 steps traced, first steps on screen | 387 ms, 32 ms | < 1 s first chunk |
| Showing any step (p50 / p95) | 0.3 / 0.5 ms | < 50 ms |

## Running other people's code

| Threat | What stops it |
|---|---|
| Infinite loop | 50,000 steps / 5 s, checked every step; the trace so far is kept, marked incomplete |
| A loop inside one C call | the worker is killed 2 s past the limit; a spare takes over at once |
| `except BaseException:` swallowing the stop | the stop is reported before it is raised; the worker is killed if control does not return |
| Output flood | 256 KB, then stop |
| Network | fetch, XMLHttpRequest, WebSocket, EventSource, BroadcastChannel, FontFace, indexedDB, caches and postMessage are deleted from the worker before any program runs — checked in the browser |
| Forged traces | results travel over a MessagePort held in a closure |
| One run poisoning the next | builtins and every preloaded module restored after each run; the tracer keeps its own builtins and uses json's C encoder |
| Page freeze | everything runs in a worker |

Not closed yet: `import()` is syntax, not a global, so code reaching
`js.eval` could still request a URL (it cannot read a same-origin response).
A Content-Security-Policy on this page closes it — a Blob worker inherits the
page's policy:

```
/officina/ai
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src blob:; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'
```

It needs testing against the deployed page before it goes into
`public/_headers`: the site's router and prefetching also run under it.

## Tests

```bash
npm run test:officina-ai
```

Needs Python 3.14 — the version Pyodide 314 embeds. CI installs it beside the
3.12 the Elementa snippets use and passes it as `OFFICINA_PYTHON`. The speed
budgets are asserted locally and only reported in CI, where they mostly
measure the runner.

## Next

The AI layer: a provider interface with **No AI** working exactly as now;
the owner has chosen local, in-browser (WebLLM), loaded only when a reader
turns it on. Then C/C++ (emception, with source instrumentation), Java, and
an assembly simulator — each producing the same step format.
