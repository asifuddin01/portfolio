/**
 * The facts a step carries, written out for a model to put into words.
 *
 * This file is why a small model running in a browser is worth doing at all.
 * It is not asked what the program did — the interpreter already established
 * that, down to which side of a comparison held what. It is asked to say the
 * established thing in a sentence. That is a rewriting job, and rewriting is
 * what a 3B model is actually good at.
 *
 * So the rule here is: never make the model derive anything it could get
 * wrong. If a fact is in the trace, spell it out. The prompt is longer for
 * it, and the answers are enormously better.
 *
 * Everything is budgeted. The models this runs on have a few thousand tokens
 * of context, and a 50,000-step trace of a program with a hundred locals
 * would bury the one line being asked about.
 */
import type { StepView, VariableChange } from '../trace/store.ts';
import type { TraceResult, TraceStep } from '../trace/schema.ts';
import { formatValue } from '../view/format.ts';

/** Source lines shown either side of the one in view. */
const SOURCE_WINDOW = 14;
/** Variables listed per frame when nothing changed to point at. */
const VARS_PER_FRAME = 10;
/** Steps of history shown before the one in view. */
const HISTORY = 6;
/** Room given to any single value, in characters. */
const VALUE_ROOM = 80;

const val = (v: unknown) => formatValue(v as never, VALUE_ROOM);

/**
 * The program, numbered, narrowed to the neighbourhood of one line.
 *
 * Numbered because every other fact in the prompt refers to a line number,
 * and a model that has to count lines itself will miscount. Narrowed because
 * a 300-line program spends the whole context window on code that is not
 * being asked about; when it fits, it is all shown.
 */
export function sourceAround(source: string, line: number): string {
  const lines = source.split('\n');
  const width = String(lines.length).length;
  const number = (i: number) =>
    `${String(i + 1).padStart(width)}${i + 1 === line ? ' →' : '  '} ${lines[i]}`;

  if (lines.length <= SOURCE_WINDOW * 2) return lines.map((_, i) => number(i)).join('\n');

  const from = Math.max(0, line - 1 - SOURCE_WINDOW);
  const to = Math.min(lines.length, line + SOURCE_WINDOW);
  const body = lines.slice(from, to).map((_, i) => number(from + i));
  if (from > 0) body.unshift(`${' '.repeat(width)}   … ${from} earlier line(s)`);
  if (to < lines.length) body.push(`${' '.repeat(width)}   … ${lines.length - to} more line(s)`);
  return body.join('\n');
}

/** A variable change as "before → after", or as an arrival or a departure. */
function changeLine(c: VariableChange): string {
  if (c.after === undefined) return `${c.name} was deleted (it held ${val(c.before)})`;
  if (!c.existedBefore) return `${c.name} = ${val(c.after)}  (new — it did not exist before this step)`;
  return `${c.name}: ${val(c.before)} → ${val(c.after)}`;
}

/** What the step itself did, in the trace's own terms. */
function whatHappened(step: TraceStep): string[] {
  const out: string[] = [];

  if (step.event === 'call') {
    const args = (step.args ?? []).map(([n, v]) => `${n} = ${val(v)}`).join(', ');
    out.push(`${step.function}() was entered${step.callerLine ? ` from line ${step.callerLine}` : ''}.`);
    if (args) out.push(`It was called with: ${args}`);
  } else if (step.event === 'return') {
    out.push(
      step.unwinding
        ? `${step.function}() was left because an exception is passing through it.`
        : `${step.function}() returned ${val(step.returnValue)}.`
    );
  } else if (step.event === 'exception' && step.exception) {
    out.push(`${step.exception.type} was raised: ${step.exception.message}`);
  } else {
    out.push(`Line ${step.line} finished running.`);
  }

  /* The operand values are the whole point of a condition: they are what a
     learner cannot see and what a model would otherwise invent. */
  for (const c of step.conditions ?? []) {
    const operands = (c.operands ?? [])
      .map((o) => (o.skipped ? `${o.expr} was not evaluated (short-circuited)` : `${o.expr} was ${val(o.value)}`))
      .join('; ');
    out.push(
      `The ${c.kind} test \`${c.expr}\` was ${c.result}${operands ? ` — ${operands}` : ''}.`
    );
  }

  if (step.loop?.iteration !== undefined) out.push(`This began iteration ${step.loop.iteration} of the loop on line ${step.loop.line}.`);
  if (step.loop?.done !== undefined) out.push(`The loop on line ${step.loop.line} ended after ${step.loop.done} iteration(s).`);
  if (step.stdout) out.push(`It printed: ${JSON.stringify(step.stdout)}`);
  if (step.stderr) out.push(`It wrote to stderr: ${JSON.stringify(step.stderr)}`);
  if (step.stdin) out.push(`It read from input: ${JSON.stringify(step.stdin)}`);
  if (step.partial) out.push('This line was cut off by a limit before it finished.');

  return out;
}

/** The few steps before this one, so an answer can say how execution arrived. */
function historyBefore(view: StepView, read: (i: number) => StepView): string[] {
  const out: string[] = [];
  for (let i = Math.max(0, view.index - HISTORY); i < view.index; i++) {
    const s = read(i).step;
    const what =
      s.event === 'call' ? `entered ${s.function}()`
      : s.event === 'return' ? `returned from ${s.function}()`
      : s.event === 'exception' ? `raised ${s.exception?.type ?? 'an exception'}`
      : `ran line ${s.line}`;
    const cond = s.conditions?.[0];
    out.push(`  step ${s.step}: ${what}${cond ? ` (\`${cond.expr}\` was ${cond.result})` : ''}`);
  }
  return out;
}

/**
 * Everything known about one step, as plain text.
 *
 * Plain text rather than JSON on purpose: these models were trained on far
 * more prose than on trace schemas, and they paraphrase a sentence more
 * reliably than they read a nested object.
 */
export function describeStep(
  view: StepView,
  source: string,
  read: (i: number) => StepView,
  result?: TraceResult
): string {
  const { step } = view;
  const here = view.frames[view.frames.length - 1];
  const parts: string[] = [];

  parts.push('PROGRAM (→ marks the line this step is about):', sourceAround(source, step.line), '');
  parts.push(`STEP ${step.step} of ${result?.steps ?? 'the run'} — in ${step.function}(), line ${step.line}.`);

  parts.push('', 'WHAT THIS STEP DID:');
  for (const line of whatHappened(step)) parts.push(`  ${line}`);

  if (view.changes.length) {
    parts.push('', 'VARIABLES THIS STEP CHANGED:');
    for (const c of view.changes) parts.push(`  ${changeLine(c)}`);
  } else {
    parts.push('', 'This step changed no variables.');
  }

  /* The frame in view, so a question like "what is n here?" can be answered
     without the model guessing from the source. Outer frames are named but
     not dumped — the stack matters, its locals usually do not. */
  if (here && here.vars.size) {
    const shown = [...here.vars].slice(0, VARS_PER_FRAME);
    parts.push('', `VARIABLES IN SCOPE in ${here.function}() after this step:`);
    for (const [name, v] of shown) parts.push(`  ${name} = ${val(v)}`);
    if (here.vars.size > shown.length) parts.push(`  … and ${here.vars.size - shown.length} more`);
  }

  if (view.frames.length > 1) {
    parts.push('', `CALL STACK: ${view.frames.map((f) => `${f.function}()`).join(' → ')}`);
  }

  const history = historyBefore(view, read);
  if (history.length) parts.push('', 'THE STEPS JUST BEFORE THIS ONE:', ...history);

  if (view.stdout) parts.push('', `OUTPUT SO FAR:\n${JSON.stringify(view.stdout)}`);

  /* How the run ended belongs in the prompt only once it is known, and it
     changes the answer: a step inside a run that later crashed often reads
     differently from the same step in a run that finished. */
  if (result && result.status !== 'ok') {
    if (result.error) parts.push('', `THE RUN ENDED IN AN ERROR: ${result.error.type}: ${result.error.message}${result.error.line ? ` (line ${result.error.line})` : ''}`);
    else if (result.stopped) parts.push('', `THE RUN WAS STOPPED: ${result.stopped.message}`);
  }

  return parts.join('\n');
}
