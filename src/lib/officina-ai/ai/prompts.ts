/**
 * The three things the tutor asks, phrased for a model running on a laptop.
 *
 * A 3B model is a good paraphraser and a poor authority, so every prompt
 * here is built the same way: hand it the established facts, forbid it from
 * adding any, and ask for something short. The instruction that earns its
 * place most often is the one telling it not to invent a value — left to
 * itself a small model will happily narrate a plausible number over the top
 * of the real one sitting in the facts above it.
 *
 * `solve` is the exception and it is deliberately the weakest promise. A
 * small model writes buggy code. That is survivable here in a way it would
 * not be elsewhere, because the answer lands in an editor attached to an
 * interpreter: the learner runs it and the trace shows exactly where it goes
 * wrong. The model proposes; the interpreter judges. The prompt says so, so
 * the answer arrives as something to test rather than something to trust.
 */
import type { TutorRequest } from './provider.ts';
import { SYSTEM_PROMPTS } from './system-prompts.ts';
import { describeStep } from './context.ts';
import type { StepView } from '../trace/store.ts';

export interface PromptMessage {
  role: 'system' | 'user';
  content: string;
}

const SYSTEM = SYSTEM_PROMPTS;

/**
 * The top of the editor's contents, for context only.
 *
 * Not `sourceAround`: that centres a window on a line, and here there is no
 * line — the program has not been run. A flat cap keeps a long buffer from
 * eating the context window a small model needs for the actual request.
 */
const EDITOR_CONTEXT_LINES = 28;

function head(source: string): string {
  const lines = source.split('\n');
  if (lines.length <= EDITOR_CONTEXT_LINES) return source;
  return `${lines.slice(0, EDITOR_CONTEXT_LINES).join('\n')}\n# … ${lines.length - EDITOR_CONTEXT_LINES} more line(s)`;
}

/** How many steps the trace has, for resolving "step 12" back to a link. */
export interface PromptOptions {
  read: (i: number) => StepView;
}

export function buildPrompt(request: TutorRequest, options: PromptOptions): PromptMessage[] {
  const system = SYSTEM[request.task];

  if (request.task === 'solve') {
    const asked = (request.question ?? '').trim();
    /* The editor's current contents are context, not a thing to continue:
       a learner asking for a palindrome check while a sorting program sits
       in the buffer does not want the sorting program extended. */
    const existing = request.source.trim() ? `\n\nFor context, this is currently in their editor. Ignore it unless ` +
        `they asked you to change it:\n\n\`\`\`python\n${head(request.source)}\n\`\`\`` : '';
    return [
      { role: 'system', content: system },
      { role: 'user', content: `Write a Python program that does this:\n\n${asked}${existing}` },
    ];
  }

  if (!request.step) {
    return [
      { role: 'system', content: system },
      { role: 'user', content: request.question ?? 'Explain this program.' },
    ];
  }

  const facts = describeStep(request.step, request.source, options.read, request.result);

  const user =
    request.task === 'ask'
      ? `${facts}\n\n---\n\nThe learner is looking at step ${request.step.step.step} and asks:\n\n` +
        `${(request.question ?? '').trim()}\n\n` +
        `Answer from the facts above. If you refer to another step, write it as "step 12" so it can be linked.`
      : `${facts}\n\n---\n\nExplain this step to the learner.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
