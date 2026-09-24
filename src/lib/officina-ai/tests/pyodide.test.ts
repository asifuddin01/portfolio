import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadPyodide, type PyodideAPI } from 'pyodide';
import type { TraceResult, TraceStep } from '../trace/schema.ts';
import { PYTHON, TRACER, program, traceNatively } from './native.ts';

/**
 * tracer.py runs on Pyodide in the browser and on CPython in the Python
 * tests. The traces must be identical — otherwise the Python tests would be
 * checking a tracer nobody uses. This loads the same Pyodide build the page
 * serves, runs the same file inside it, and compares every step.
 */
let run: (code: string, stdin?: string, limits?: object) => { steps: TraceStep[]; result: TraceResult };

before(async () => {
  const pyodide: PyodideAPI = await loadPyodide();
  const scope = pyodide.globals.get('dict')();
  pyodide.runPython(readFileSync(TRACER, 'utf8'), { globals: scope });
  const runJson = scope.get('run_json');
  run = (code, stdin = '', limits = {}) => {
    const steps: TraceStep[] = [];
    const json = runJson(code, stdin, JSON.stringify(limits), (chunk: string) => steps.push(...JSON.parse(chunk)), null, true);
    return { steps, result: JSON.parse(json) };
  };
});

const sameVersion = (() => {
  try {
    return execFileSync(PYTHON, ['-c', 'import sys; print(sys.version_info[:2] == (3, 14))'], { encoding: 'utf8' }).trim() === 'True';
  } catch {
    return false;
  }
})();

/** Everything except what legitimately differs between the two machines. */
const comparable = ({ timing, runtime, ...rest }: TraceResult) => rest;

for (const [name, stdin] of [['mixed.py', 'mixed.stdin'], ['bubble.py'], ['fails.py']] as const) {
  test(`${name}: Pyodide and CPython produce the same trace`, { skip: !sameVersion && 'native python3 is not 3.14' }, () => {
    const native = traceNatively(program(name), stdin ? program(stdin) : undefined);
    const code = readFileSync(program(name), 'utf8');
    const browser = run(code, stdin ? readFileSync(program(stdin), 'utf8') : '');
    assert.equal(browser.steps.length, native.steps.length);
    for (let i = 0; i < native.steps.length; i++) assert.deepEqual(browser.steps[i], native.steps[i], `step ${i}`);
    assert.deepEqual(comparable(browser.result), comparable(native.result));
    assert.equal(browser.result.runtime?.implementation, 'pyodide');
  });
}

/**
 * The budget is asserted where it means something — on a developer's machine.
 * On a shared CI runner the same measurement mostly measures the runner, and a
 * deploy of unrelated content should not fail because it was slow that day;
 * there the time is reported and not judged.
 */
test('a ~5,000-step program traces within the 500 ms budget (§27.8)', () => {
  const code = readFileSync(program('bubble.py'), 'utf8');
  run(code);                                        // first run pays for imports
  const times: number[] = [];
  let steps = 0;
  for (let k = 0; k < 5; k++) {
    const began = performance.now();
    steps = run(code).steps.length;
    times.push(performance.now() - began);
  }
  times.sort((a, b) => a - b);
  const median = times[2];
  console.log(`  bubble.py: ${steps} steps, median ${median.toFixed(0)} ms on Pyodide`);
  assert.ok(steps > 4500, `expected ~5,000 steps, got ${steps}`);
  if (!process.env.CI) assert.ok(median < 500, `median ${median.toFixed(0)} ms`);
});

test('limits hold inside Pyodide', () => {
  const { result } = run('while True:\n    pass\n', '', { max_steps: 500 });
  assert.equal(result.status, 'stopped');
  assert.equal(result.stopped?.reason, 'steps');
  assert.equal(result.complete, false);
});

test('runs do not leak into each other inside one interpreter', () => {
  run('import math, builtins\nmath.pi = 3\nbuiltins.len = None\n');
  const { result } = run('import math\nprint(math.pi > 3.1, len("ab"))\n');
  assert.equal(result.stdout, 'True 2\n');
});
