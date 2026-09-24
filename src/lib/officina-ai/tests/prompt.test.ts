import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TraceStore } from '../trace/store.ts';
import { describeStep, sourceAround } from '../ai/context.ts';
import { buildPrompt } from '../ai/prompts.ts';
import { stepsNamedIn } from '../ai/provider.ts';
import { program, traceNatively } from './native.ts';
import { readFileSync } from 'node:fs';

/**
 * The tutor's one real risk is a model that narrates a plausible value over
 * the top of the true one. The defence is not in the model — it is here, in
 * what the prompt is made of: if every fact the answer needs is already
 * written down, the model has nothing left to invent.
 *
 * So these tests are about the prompt's contents, not the model's output.
 * They assert that the facts a learner would ask about — what each side of a
 * comparison held, what a variable was before and after — actually reach the
 * model, and that they do so inside a budget a 4k context window can take.
 */

function load(name: string) {
  const source = readFileSync(program(name), 'utf8');
  const { steps, result } = traceNatively(program(name));
  const store = new TraceStore();
  store.append(steps);
  store.finish(result);
  return { source, steps, result, store, read: (i: number) => store.at(i) };
}

test('a condition reaches the model with both operands and its result', () => {
  const { source, steps, store, read, result } = load('bubble.py');

  const index = steps.findIndex((s) => s.conditions?.some((c) => c.operands?.length === 2));
  assert.ok(index >= 0, 'bubble.py should produce a two-operand condition');

  const view = store.at(index);
  const text = describeStep(view, source, read, result);
  const condition = view.step.conditions!.find((c) => c.operands?.length === 2)!;

  assert.ok(text.includes(condition.expr), 'the test expression itself');
  assert.match(text, new RegExp(`was ${condition.result}`), 'the result of the test');
  for (const operand of condition.operands!) {
    assert.ok(text.includes(operand.expr), `operand text ${operand.expr}`);
  }
  // The values are the part a learner cannot see and a model would invent.
  assert.match(text, /\bwas \d+/, 'at least one operand spelled with its value');
});

test('a variable change reaches the model as before and after', () => {
  const { source, store, read, steps } = load('bubble.py');
  const index = steps.findIndex((s, i) => i > 0 && store.at(i).changes.some((c) => c.existedBefore));
  assert.ok(index >= 0);

  const view = store.at(index);
  const change = view.changes.find((c) => c.existedBefore)!;
  const text = describeStep(view, source, read);

  assert.ok(text.includes(`${change.name}:`), 'the variable is named');
  assert.ok(text.includes('→'), 'before and after are both given');
});

test('a new variable is marked as new rather than as a change from nothing', () => {
  const { source, store, read, steps } = load('bubble.py');
  const index = steps.findIndex((_, i) => store.at(i).changes.some((c) => !c.existedBefore));
  const text = describeStep(store.at(index), source, read);
  assert.match(text, /did not exist before this step/);
});

test('the prompt stays inside a small context window', () => {
  const { source, store, read, result, steps } = load('bubble.py');
  // A 60-element list being sorted: the worst case this suite has for bulk.
  let largest = 0;
  for (let i = 0; i < steps.length; i += Math.ceil(steps.length / 60)) {
    const messages = buildPrompt(
      { task: 'explain', source, step: store.at(i), result },
      { read }
    );
    largest = Math.max(largest, messages.reduce((n, m) => n + m.content.length, 0));
  }
  // ~4 characters a token, against a 4096-token window with room for an answer.
  assert.ok(largest < 9000, `largest prompt was ${largest} characters`);
});

test('the source window narrows around the line but keeps the numbering true', () => {
  const source = Array.from({ length: 200 }, (_, i) => `x = ${i}`).join('\n');
  const text = sourceAround(source, 120);
  assert.ok(text.includes('120 → x = 119'), 'the line in view is marked and numbered from one');
  assert.ok(!text.includes('x = 0\n'), 'distant lines are dropped');
  assert.match(text, /earlier line\(s\)/, 'and the reader is told they were dropped');
});

test('solve is asked without trace facts, and does not inherit the buffer wholesale', () => {
  const source = Array.from({ length: 90 }, (_, i) => `line_${i} = ${i}`).join('\n');
  const [system, user] = buildPrompt(
    { task: 'solve', source, question: 'check whether a word is a palindrome' },
    { read: () => { throw new Error('solve must not read the trace'); } }
  );
  assert.match(system.content, /Python/);
  assert.ok(user.content.includes('palindrome'));
  assert.ok(!user.content.includes('WHAT THIS STEP DID'), 'no step facts');
  assert.match(user.content, /more line\(s\)/, 'the editor buffer is capped');
  assert.ok(user.content.includes('Ignore it unless'), 'and marked as context, not as a thing to extend');
});

test('step references are parsed, and only when they say "step"', () => {
  assert.deepEqual(stepsNamedIn('see step 12 and Step #3', 100), [3, 12]);
  assert.deepEqual(stepsNamedIn('n was 12 and xs had 3 items', 100), [], 'bare numbers are values, not steps');
  assert.deepEqual(stepsNamedIn('step 900', 100), [], 'out of range is dropped');
});
