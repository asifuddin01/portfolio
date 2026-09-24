import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPyodide, type PyodideAPI } from 'pyodide';

/**
 * notebook.py — /officina's cell runner — inside the same Pyodide build the
 * page uses, loaded the way worker.js loads it.
 */
const SOURCE = readFileSync(fileURLToPath(new URL('../python/notebook.py', import.meta.url)), 'utf8');

let pyodide: PyodideAPI;
let run: (code: string, limit?: number) => Promise<{ outcome: string; output: string; chunks: string[]; at: number[]; ended: number }>;

before(async () => {
  pyodide = await loadPyodide();
  pyodide.setStdin({ stdin: () => null });                 // as worker.js does
  const scope = pyodide.globals.get('dict')();
  pyodide.runPython(SOURCE, { globals: scope, filename: '<officina-notebook>' });
  const runCell = scope.get('run_cell');
  run = async (code, limit = 256 * 1024) => {
    const chunks: string[] = [];
    const at: number[] = [];
    const outcome = String(await runCell(code, limit, (text: string) => { chunks.push(text); at.push(performance.now()); }));
    return { outcome, output: chunks.join(''), chunks, at, ended: performance.now() };
  };
});

test('cells share a namespace, as in Jupyter', async () => {
  assert.equal((await run('x = 41')).outcome, 'ok');
  const r = await run('print(x + 1)');
  assert.deepEqual([r.outcome, r.output], ['ok', '42\n']);
});

test('stdout and stderr arrive together, in the order written', async () => {
  const r = await run('import sys\nprint("a")\nprint("b", file=sys.stderr)\nprint("c")');
  assert.equal(r.output, 'a\nb\nc\n');
});

test('a failure is a traceback after the output, pointing at the reader\'s code', async () => {
  const r = await run('print("before")\n1 / 0');
  assert.equal(r.outcome, 'error');
  assert.ok(r.output.startsWith('before\nTraceback (most recent call last):'));
  assert.match(r.output, /File "<exec>", line 2/);
  assert.match(r.output, /ZeroDivisionError: division by zero\n$/);
  // The runner's own frames must not look like the reader's.
  assert.doesNotMatch(r.output, /officina-notebook/);
});

test('a syntax error is reported where it is', async () => {
  const r = await run('x = (1,\n');
  assert.equal(r.outcome, 'error');
  assert.match(r.output, /File "<exec>", line 1/);
  assert.match(r.output, /SyntaxError/);
});

test('output is capped, and `except Exception` cannot swallow the cap', async () => {
  const r = await run('while True:\n    try:\n        print("x" * 100)\n    except Exception:\n        pass', 1000);
  assert.equal(r.outcome, 'output-limit');
  assert.equal(r.output.length, 1000);
});

test('long output arrives in pieces while the cell runs', async () => {
  const r = await run('for i in range(3000):\n    print("line", i)');
  assert.equal(r.outcome, 'ok');
  assert.ok(r.chunks.length > 1, `one chunk of ${r.output.length} characters`);
  assert.equal(r.output.split('\n').length, 3001);
});

test('a line printed before a silent stretch is sent at once, not at the end', async () => {
  // What Stop depends on: the worker is killed mid-loop, so anything still
  // waiting to be sent is lost with it.
  const r = await run('print("before the loop")\nimport time\nt = time.perf_counter()\nwhile time.perf_counter() - t < 0.3:\n    pass');
  assert.equal(r.chunks[0], 'before the loop');
  assert.ok(r.ended - r.at[0] > 250, `the first line arrived ${Math.round(r.ended - r.at[0])} ms before the end`);
});

test('input() reads end-of-file: a worker has no keyboard', async () => {
  const r = await run('name = input("Name? ")');
  assert.equal(r.outcome, 'error');
  assert.match(r.output, /EOFError/);
  // The example that reads stdin politely still works.
  const polite = await run('import sys\nraw = sys.stdin.readline().strip() if not sys.stdin.isatty() else ""\nprint(f"Hello, {raw or \'world\'}")');
  assert.equal(polite.output, 'Hello, world\n');
});

test('top-level await works, as it did on the page', async () => {
  const r = await run('import asyncio\nawait asyncio.sleep(0)\nprint("awaited")');
  assert.deepEqual([r.outcome, r.output], ['ok', 'awaited\n']);
});

test('stdout is restored after every cell', async () => {
  await run('print("x")');
  assert.equal(pyodide.runPython('import sys; type(sys.stdout).__name__'), pyodide.runPython('import sys; type(sys.__stdout__).__name__'));
});
