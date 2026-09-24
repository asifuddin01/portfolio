/**
 * The tutor's model, on this site's server.
 *
 * The page asks /api/tutor (edge/tutor.js), which asks Cloudflare Workers AI
 * and streams the answer back. Nothing to download and nothing to load: the
 * tutor is ready the moment the page is, on any device with a connection.
 *
 * The price of that is that asking sends something away: the program and the
 * facts of the step in view go to the model to be answered. The panel says
 * so beside every question, and nothing is kept. Running and tracing still
 * never leave the browser — only a question does.
 */
import type {
  Explanation, TutorChunk, TutorProvider, TutorRequest, TutorState,
} from './provider.ts';
import { stepsNamedIn } from './provider.ts';
import { buildPrompt } from './prompts.ts';
import type { StepView } from '../trace/store.ts';

export interface RemoteOptions {
  /** Where the tutor answers. The site's own Worker, same origin. */
  endpoint?: string;
  totalSteps(): number;
  read(index: number): StepView;
}

/**
 * The text one streamed event adds to an answer that so far reads `before`.
 *
 * Workers AI streams `{"response": "…"}` for most models and the OpenAI shape
 * `{"choices": [{"delta": {"content": "…"}}]}` for some newer ones; reading
 * both means changing the model in system-prompts.ts never touches the page.
 *
 * It also parses each token as JSON when it can, and sends the value rather
 * than the text. So a digit arrives as a number — `{"response": 6}` — and
 * the words `true`, `false` and `null` as those JSON values, having lost the
 * space in front of them on the way (" null" parses to null). Digits come
 * with a space token of their own, so a number needs only turning back into
 * text; a word gets its space back unless it follows one already, or an
 * opening bracket or quote. Reading strings alone dropped every number and
 * every `True`/`None`-like word from every answer — in a tutor about values,
 * most of what mattered.
 */
export function pieceOf(event: unknown, before = ''): string {
  const e = event as { response?: unknown; choices?: { delta?: { content?: unknown } }[] };
  const piece = e?.response !== undefined ? e.response : e?.choices?.[0]?.delta?.content;
  if (typeof piece === 'string') return piece;
  if (typeof piece === 'number') return String(piece);
  if (typeof piece === 'boolean' || piece === null) {
    const word = String(piece);
    return before && !/[\s([{`'"]$/.test(before) ? ` ${word}` : word;
  }
  return '';
}

/** Split a growing server-sent-event stream into complete `data:` payloads. */
export function takeEvents(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let rest = buffer;
  let end: number;
  while ((end = rest.indexOf('\n\n')) !== -1) {
    const block = rest.slice(0, end);
    rest = rest.slice(end + 2);
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data) events.push(data);
  }
  return { events, rest };
}

export class RemoteProvider implements TutorProvider {
  readonly name = 'Qwen2.5 Coder 32B, on this site’s server';
  readonly state: TutorState = 'ready';
  private readonly endpoint: string;
  private readonly options: RemoteOptions;

  constructor(options: RemoteOptions) {
    this.options = options;
    this.endpoint = options.endpoint ?? '/api/tutor';
  }

  async available(): Promise<boolean> {
    return true;
  }

  async load(): Promise<void> {}

  async unload(): Promise<void> {}

  async *answer(request: TutorRequest, signal: AbortSignal): AsyncIterable<TutorChunk> {
    const [, user] = buildPrompt(request, { read: this.options.read });

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: request.task, prompt: user.content }),
        signal,
      });
    } catch (error) {
      yield signal.aborted
        ? { type: 'error', kind: 'cancelled', message: 'Stopped.' }
        : { type: 'error', kind: 'engine', message: 'The tutor could not be reached. Check the connection and ask again.' };
      return;
    }

    if (!response.ok || !response.body) {
      let message = 'The tutor could not answer just now.';
      try {
        message = ((await response.json()) as { message?: string }).message ?? message;
      } catch { /* not JSON: keep the plain message */ }
      yield { type: 'error', kind: response.status === 503 ? 'unsupported' : 'engine', message };
      return;
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let text = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const { events, rest } = takeEvents(buffer);
        buffer = rest;
        for (const data of events) {
          if (data === '[DONE]') continue;
          let delta = '';
          try {
            delta = pieceOf(JSON.parse(data), text);
          } catch { /* a malformed event is skipped, not fatal */ }
          if (delta) {
            text += delta;
            yield { type: 'delta', text: delta };
          }
        }
      }
    } catch {
      if (signal.aborted) {
        yield { type: 'error', kind: 'cancelled', message: 'Stopped.' };
        return;
      }
      yield { type: 'error', kind: 'engine', message: 'The answer was cut off. Ask again.' };
      return;
    } finally {
      reader.releaseLock();
    }

    if (signal.aborted) {
      yield { type: 'error', kind: 'cancelled', message: 'Stopped.' };
      return;
    }
    const explanation: Explanation = {
      task: request.task,
      text: text.trim(),
      steps: stepsNamedIn(text, this.options.totalSteps()),
      streaming: false,
    };
    yield { type: 'done', explanation };
  }
}
