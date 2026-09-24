/**
 * The Officina AI tutor's model, answering from this site's Worker.
 *
 * POST /api/tutor  { task: 'explain' | 'ask' | 'solve', prompt: string }
 *   → text/event-stream from Cloudflare Workers AI, one `data:` line per
 *     piece of the answer, ending with `data: [DONE]`.
 *
 * The page builds the prompt's facts from the trace in the reader's browser
 * (src/lib/officina-ai/ai/prompts.ts) and sends only those and the task. The
 * standing instructions are added here, from the one file both sides read,
 * so a caller can pick a task but never tell the model what it is — the
 * endpoint cannot be used as a general chatbot on this site's account.
 *
 * What stands between it and the account's allowance: same-origin requests
 * only, a size cap on the prompt, a cap on each answer, and a per-visitor
 * rate limit. Nothing is stored; the program and its facts are sent to the
 * model to be answered and kept nowhere.
 */
import {
  SYSTEM_PROMPTS,
  TUTOR_MODEL,
  MAX_PROMPT_CHARS,
  MAX_ANSWER_TOKENS,
} from '../src/lib/officina-ai/ai/system-prompts.ts';

const reply = (status, error, message) =>
  new Response(JSON.stringify({ error, message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function tutor(request, env) {
  if (request.method !== 'POST') return reply(405, 'method', 'The tutor answers POST requests only.');

  // The tutor serves this site's page. A browser on another site sends its
  // own Origin; a script with no Origin at all still meets the rate limit.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return reply(403, 'cross-origin', 'The tutor answers this site only.');
  }

  if (!env.AI) return reply(503, 'unavailable', 'The tutor is not switched on for this deployment.');

  if (env.TUTOR_RATE) {
    const visitor = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await env.TUTOR_RATE.limit({ key: visitor });
    if (!success) {
      return reply(429, 'slow-down', 'The tutor answers ten questions a minute for each visitor. Try again in a moment.');
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return reply(400, 'bad-request', 'Send JSON: { task, prompt }.');
  }
  const { task, prompt } = body ?? {};
  if (!Object.hasOwn(SYSTEM_PROMPTS, task)) return reply(400, 'bad-request', 'Unknown task.');
  if (typeof prompt !== 'string' || !prompt.trim()) return reply(400, 'bad-request', 'Nothing to ask.');
  if (prompt.length > MAX_PROMPT_CHARS) return reply(413, 'too-long', 'That is more than the tutor reads at once.');

  try {
    const stream = await env.AI.run(TUTOR_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS[task] },
        { role: 'user', content: prompt },
      ],
      stream: true,
      max_tokens: MAX_ANSWER_TOKENS[task],
      // Low, not zero: these are explanations of fixed facts, and sampling
      // variety buys nothing but the chance of a wrong one.
      temperature: 0.2,
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    // Most often the account's free allowance for the day is spent.
    console.error('tutor:', err);
    return reply(503, 'model', 'The tutor could not answer just now. It may have used up today\'s allowance — try again later.');
  }
}
