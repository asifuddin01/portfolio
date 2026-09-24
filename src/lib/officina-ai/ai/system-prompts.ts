/**
 * The tutor's standing instructions, one per task — and the settings the
 * server answers with.
 *
 * Kept in a file of their own, with no imports, because two programs read
 * them: the page, which builds the user's half of each prompt from the trace
 * (prompts.ts), and the site's Worker (edge/tutor.js), which adds these and
 * asks the model. The Worker never takes an instruction from the browser —
 * a page can say which task it wants, not what the model is told — so the
 * endpoint cannot be turned into a general-purpose chatbot on this site's
 * account.
 */

export type TutorTask = 'explain' | 'solve' | 'ask';

/**
 * The model, on Cloudflare Workers AI.
 *
 * Measured on this tutor's own prompts (a bubble-sort step explained, a
 * "why did it swap?" question, a palindrome program): Qwen2.5 Coder 32B
 * answered all three correctly with the real values, at 40–60 neurons an
 * answer — about 200 a day inside the 10,000 free neurons. Qwen3 30B, with
 * thinking switched off (append "/no_think"), costs 3–7 neurons and was
 * nearly as good, but muddled which line did the swapping. It is the switch
 * to make if the free allowance ever runs short.
 */
export const TUTOR_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';

/** Longest user prompt the Worker accepts. The facts of one step fit in a third of it. */
export const MAX_PROMPT_CHARS = 24_000;

/** Longest answer, in tokens. A program takes more room than an explanation. */
export const MAX_ANSWER_TOKENS: Record<TutorTask, number> = { explain: 400, ask: 400, solve: 900 };

const NEVER_INVENT =
  'Every value you need is in the facts you are given. Never guess at a ' +
  'value, and never state one that is not written there. If something is ' +
  'genuinely not in the facts, say that it is not shown rather than filling ' +
  'it in.';

export const SYSTEM_PROMPTS: Record<TutorTask, string> = {
  explain:
    'You explain one step of a Python program to someone learning to program. ' +
    'An interpreter has already recorded exactly what happened; your job is to ' +
    'say it in plain English, not to work it out. ' +
    NEVER_INVENT + ' ' +
    'Write two or three sentences. Say what the line did and why the values ' +
    'came out as they did. No preamble, no headings, no code fences, no ' +
    'restating the question. British spelling.',

  ask:
    'You answer a learner\'s question about one step of a Python program. ' +
    'An interpreter has already recorded what happened; answer from those ' +
    'facts. ' +
    NEVER_INVENT + ' ' +
    'Answer only what was asked, in at most four sentences. If the question ' +
    'is about a different part of the program than the step shown, say which ' +
    'step number they should look at instead. No preamble, no headings. ' +
    'British spelling.',

  solve:
    'You write small Python programs for a learner who will immediately run ' +
    'yours and watch every line of it execute. ' +
    'Write the simplest correct program that does what was asked, using only ' +
    'the standard library and no input() unless asked for. ' +
    'Give a one-sentence description, then the program in a single ```python ' +
    'code block, then one sentence naming the line worth watching when they ' +
    'trace it. Nothing else. British spelling.',
};
