import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TraceStore } from '../trace/store.ts';
import type { TraceStep, TraceValue } from '../trace/schema.ts';
import { program, traceNatively } from './native.ts';

/**
 * The store is what makes stepping free, so it must also be right: the state
 * it reconstructs at step n has to equal replaying every change from the
 * start. This checks that, for every step of real traces, against a replay
 * written as plainly as possible.
 */
function replay(steps: TraceStep[], upTo: number) {
  const frames = new Map<number, { fn: string; vars: Map<string, TraceValue> }>();
  const order: number[] = [];
  let out = '';
  for (let i = 0; i <= upTo; i++) {
    const s = steps[i];
    const previous = steps[i - 1];
    if (previous?.event === 'return') {
      frames.delete(previous.fid);
      order.splice(order.indexOf(previous.fid), 1);
    }
    if (s.event === 'call') {
      frames.set(s.fid, { fn: s.function, vars: new Map() });
      order.push(s.fid);
    }
    for (const c of s.changes ?? []) {
      const f = frames.get(c[0])!;
      if (c.length === 3) f.vars.set(c[1], c[2]);
      else f.vars.delete(c[1]);
    }
    out += s.stdout ?? '';
  }
  return { order, frames, out };
}

function load(steps: TraceStep[], chunk = 97) {
  const store = new TraceStore();
  for (let i = 0; i < steps.length; i += chunk) store.append(steps.slice(i, i + chunk));
  return store;
}

for (const name of ['mixed.py', 'bubble.py', 'fails.py']) {
  test(`every step of ${name} matches a full replay`, () => {
    const { steps } = traceNatively(program(name), name === 'mixed.py' ? program('mixed.stdin') : undefined);
    const store = load(steps);
    assert.equal(store.length, steps.length);
    for (let i = 0; i < steps.length; i++) {
      const view = store.at(i);
      const want = replay(steps, i);
      assert.deepEqual(view.frames.map((f) => f.fid), want.order, `frames at step ${i}`);
      for (const f of view.frames) {
        assert.deepEqual(f.vars, want.frames.get(f.fid)!.vars, `variables of ${f.function} at step ${i}`);
      }
      assert.equal(view.stdout, want.out, `stdout at step ${i}`);
    }
  });
}

test('a step reports what each variable was before it', () => {
  const { steps } = traceNatively(program('bubble.py'));
  const store = load(steps);
  const swap = steps.findIndex((s) => s.event === 'line' && s.function === 'bubble' && s.changes?.some((c) => c[1] === 'xs'));
  const view = store.at(swap);
  const xs = view.changes.find((c) => c.name === 'xs')!;
  assert.ok(xs.existedBefore);
  assert.notDeepEqual(xs.before, xs.after);
});

test('a returning frame is still shown on its return step, then removed', () => {
  const { steps } = traceNatively(program('fails.py'));
  const store = load(steps);
  const ret = steps.findIndex((s) => s.event === 'return' && s.function === 'average');
  const at = store.at(ret);
  assert.ok(at.frames.at(-1)!.returning);
  assert.equal(store.at(ret + 1).frames.some((f) => f.fid === steps[ret].fid), false);
});

test('callers show the line they are waiting on', () => {
  const { steps } = traceNatively(program('mixed.py'), program('mixed.stdin'));
  const store = load(steps);
  const inner = steps.findIndex((s) => s.event === 'line' && s.function === 'fact' && s.depth === 3);
  const frames = store.at(inner).frames;
  const caller = frames[frames.length - 2];
  assert.equal(caller.function, 'fact');
  assert.equal(caller.line, 11);
});

test('steps must arrive in order', () => {
  const store = new TraceStore();
  assert.throws(() => store.append([{ step: 3, event: 'line', line: 1, fid: 0, function: '<module>', depth: 0 }]));
});

test('reading any step of a 100,000-step trace is fast', () => {
  const steps: TraceStep[] = [{ step: 0, event: 'call', line: 0, fid: 0, function: '<module>', depth: 0 }];
  for (let i = 1; i < 100_000; i++) {
    steps.push({ step: i, event: 'line', line: 2 + (i % 5), fid: 0, function: '<module>', depth: 0,
      changes: [[0, `v${i % 20}`, i]], stdout: i % 50 === 0 ? `${i}\n` : undefined });
  }
  const store = load(steps, 1000);
  const began = performance.now();
  for (let k = 0; k < 2000; k++) store.at(Math.floor(Math.random() * steps.length));
  const each = (performance.now() - began) / 2000;
  // Budget for prev/next/scrub is 50 ms including paint (build guide §27.8).
  assert.ok(each < 1, `store.at took ${each.toFixed(3)} ms per step`);
});
