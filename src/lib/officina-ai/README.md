# Officina AI

The engine behind [/officina/ai](../../pages/officina/ai.astro): write a
Python, C or Java program, trace it, step through what it did. The page is reached from
the button in the Officina header — deliberately not from the notebook's
toolbar, which acts on cells.

> The computer executes. The AI explains. The learner understands.

The trace comes from running the program, never from a model. A language model
may later explain a trace; it will not write one.

## Layout

```
python/tracer.py     runs a program under sys.settrace and records what finished at each step
python/worker.js     Pyodide in a module worker, network removed — shared by both pages
python/worker-client.ts   that worker, seen from the page
python/runtime.ts    /officina/ai: traces, with a pre-loaded spare, limits, cancellation, cache
python/notebook.py   /officina: runs notebook cells in a shared namespace, output streamed and capped
python/session.ts    /officina: one cell at a time, Stop, a 30 s limit, a spare for instant restart
compiled/instrument-c.ts     C: adds the tracing calls, on the lines they belong to (tree-sitter)
compiled/instrument-java.ts  Java: the same
compiled/instrument.ts       what both share: insert-only edits that never add a line
compiled/trace.h, trace.c    the C runtime linked into every traced program
compiled/OfficinaTrace.java  the Java runtime compiled beside every traced program
compiled/wire.ts     reads the steps a traced program writes, as it writes them
compiled/runtime.ts  compiles and runs C (emception's clang) and Java (ecj on CheerpJ)
trace/schema.ts      the step format — language-independent, facts only
trace/store.ts       holds a trace; the state at any step, checkpointed every 256 steps
trace/cache.ts       traces keyed by a hash of everything that determines them
view/trace-view.ts   the viewer; every navigation is a read from the store
view/format.ts       values spelled as each language prints them
view/highlight.ts    minimal Python, C and Java highlighting
view/tutor-panel.ts  the tutor: explain this step, ask about it, write a program
ai/provider.ts       what the tutor asks of a model, and nothing about which model
ai/context.ts        a step's facts written out, so the model never has to work one out
ai/prompts.ts        the three prompts: explain, ask, solve
ai/system-prompts.ts the instructions and the model, read by the page and the Worker
ai/remote.ts         the page's side: asks /api/tutor and reads the stream
tests/               the tracers natively (CPython 3.14, clang, javac), the store, the formatter, Pyodide parity
```

The examples are the `recipes` collection's Python, C and Java entries — the
notebook's — editable from /admin as "Officina examples". Each language's
`Tracing` group opens first; an example's optional `stdin` fills the Input box.

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

## The notebook uses the same worker

/officina's Python cells run in this worker too (session.ts, notebook.py),
not on the page's main thread as they used to. Before, `while True: pass`
froze the tab with no way out, output had no cap, and a cell could
`import js` and reach the page — `js.fetch` with the site's cookies,
`js.localStorage` with the CMS token. Now a cell can be stopped (Stop, or
30 s), output stops at 256 KB, and none of the page is reachable. Stopping
terminates the worker, so earlier cells' variables go with it; the cell says
so. `input()` reads end-of-file — a worker has no keyboard.

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

Needs Python 3.14 — the version Pyodide 314 embeds — clang, and a JDK that can
compile for Java 8 (`--release 8`; locally `brew install openjdk@17`). CI
installs Python 3.14 beside the 3.12 the Elementa snippets use and passes it as
`OFFICINA_PYTHON`, and a JDK 17 as `OFFICINA_JAVA_HOME`. The C and Java tests
trace every example in the recipes and hold each to printing exactly what it
prints untraced. The speed
budgets are asserted locally and only reported in CI, where they mostly
measure the runner.

## The tutor

Explain this step, a question about it, or a program written to order —
answered by a language model on this site's server, so there is nothing for
a reader to download. The page asks `/api/tutor` (edge/tutor.js), which asks
Cloudflare Workers AI (Qwen2.5 Coder 32B) and streams the answer back.

The model is never asked what the program did. `ai/context.ts` writes out
everything the interpreter recorded about the step in view — including the
operand values a learner cannot see and a model would otherwise invent — and
the prompts forbid adding to it. Answers are labelled as the model's account,
step numbers in them link back to the trace, and a program it writes goes
into the editor to be traced like any other.

The page sends a task and the facts; the Worker adds the instructions, from
`ai/system-prompts.ts`, which both sides read. A caller can pick a task but
never tell the model what it is, so the endpoint is no general chatbot on this
account. It also takes same-origin requests only, caps the prompt and each
answer, and allows ten questions a minute per visitor (`TUTOR_RATE` in
wrangler.jsonc).

**What it sends, and costs.** Asking sends the program and the step's facts
to Workers AI to be answered; nothing is kept, and the panel says so beside
the questions. Running and tracing still never leave the browser. An answer
costs about 40–60 neurons — roughly 200 a day inside the account's 10,000
free. Past that the tutor says it has used today's allowance. `TUTOR_MODEL`
is the one line to change: Qwen3 30B with `/no_think` costs a tenth as much,
and was nearly as good on these prompts.

**One quirk to know.** Workers AI parses each streamed token as JSON when it
can, so digits arrive as numbers and `true`/`false`/`null` as bare values
without their leading space. `ai/remote.ts` puts them back; without that,
every number vanished from every answer.

The tutor was first written, by another session, to run a model in the
reader's browser (WebLLM). It was replaced before release: a 2.4 GB download
per reader is not something a page on this site should ask for. The provider
interface (`ai/provider.ts`) still takes such a model.

## C and Java

Neither has a settrace, so the program reports on itself. Before it is
compiled, `compiled/instrument-*.ts` parses it with tree-sitter and inserts
calls into the runtime — `_ot_at(line)` before each statement, a step after
it, a wrapper round every if, loop and `?:` test that records its result and
operand values as the program computes them. Insertions only, never a new
line, so every compiler message still points at the line the reader wrote.
The program is then compiled with the notebook's own toolchains, in the
browser, and run; it writes one JSON line per step, the same format Python's
tracer produces, and `compiled/wire.ts` reads them into the store.

**C** (`trace.c`) registers each variable's address, type and size when its
declaration runs and forgets it when its block ends — a `cleanup` attribute
catches break, continue and return alike. After every statement it reads the
registered memory back, hashes it, and renders only what changed, so a callee
changing its caller's array through a pointer shows at the step it did it.
Pointers are shown by what they point at (`→ a[1] in main()`), structs and
enums through functions the instrumenter writes for each type. A variable
declared without a value is filled with 0xAA and shown as `?` until the
program sets it. Indexing past an array, dividing by zero and following a
NULL pointer are caught by clang's sanitizer checks, whose handlers the
runtime provides: the trace stops on that line, where C itself would carry on
into undefined behaviour. The program's stdio is redirected into the runtime,
so each step knows what it printed and read.

**Java** (`OfficinaTrace.java`) cannot name a caller's locals, so each step
passes the values of the variables in scope — only those the compiler agrees
are definitely assigned. Each value is rendered and compared with its last
rendering; arrays and objects a waiting caller holds are rendered again at
every step, because a method it called can change them. Objects are read by
reflection, never `toString()`. Code inside a lambda runs untraced.

Limits are the same as Python's — 50,000 steps, 5 s, 256 KB of output —
enforced inside the program, so a stopped run ends itself. A C program still
running 3 s past its limit is killed with its toolchain. The JVM runs on the
page's thread, as in the notebook: CheerpJ does not run in a worker.

What costs time is the compilers. clang in WebAssembly copies 2,446 headers
into every run it starts, so a C program takes several seconds to build;
the tracer's own `trace.c` is compiled once and kept, with a stamp, in the
toolchain's storage. A program is built once however many inputs it is
traced with: a new input reruns it without compiling (about 0.8 s for Java).

Not traced: `goto`, `setjmp`/`longjmp` and threads (refused, with the line
that says why); inside lambdas; heap blocks behind a pointer (shown as an
address). `stdin` is passed to the program as an argument: without
SharedArrayBuffer the toolchain cannot feed it any other way.

## Next

An assembly simulator, producing the same step format.
