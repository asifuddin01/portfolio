import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteProvider, pieceOf, takeEvents } from '../ai/remote.ts';
import type { TutorChunk } from '../ai/provider.ts';
import type { StepView } from '../trace/store.ts';

/**
 * The page's half of the tutor: reading the answer as the site's Worker
 * streams it from Workers AI. The Worker is replaced by a fetch that returns
 * a stream cut at awkward places, as a real network does.
 */

const step: StepView = {
  index: 3,
  step: { step: 3, event: 'line', line: 2, fid: 0, function: '<module>', depth: 0 },
  frames: [{ fid: 0, function: '<module>', depth: 0, line: 2, vars: new Map([['x', 42]]) }],
  changes: [],
  stdout: '',
  stderr: '',
};

function provider() {
  return new RemoteProvider({ endpoint: 'https://test/api/tutor', totalSteps: () => 10, read: () => step });
}

async function collect(chunks: AsyncIterable<TutorChunk>) {
  const out: TutorChunk[] = [];
  for await (const c of chunks) out.push(c);
  return out;
}

function serve(response: () => Response) {
  const real = globalThis.fetch;
  const sent: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return response();
  }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = real; } };
}

/** A stream that arrives in pieces cut through the middle of events. */
function streamOf(text: string, cut = 7) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += cut) controller.enqueue(bytes.slice(i, i + cut));
      controller.close();
    },
  });
}

test('events are read whole even when the network cuts them apart', () => {
  const first = takeEvents('data: {"response":"a"}\n\ndata: {"resp');
  assert.deepEqual(first.events, ['{"response":"a"}']);
  const second = takeEvents(first.rest + 'onse":"b"}\n\ndata: [DONE]\n\n');
  assert.deepEqual(second.events, ['{"response":"b"}', '[DONE]']);
  assert.equal(second.rest, '');
});

test('both of Workers AI\'s streaming shapes are understood', () => {
  assert.equal(pieceOf({ response: 'x' }), 'x');
  assert.equal(pieceOf({ choices: [{ delta: { content: 'y' } }] }), 'y');
  assert.equal(pieceOf({ usage: {} }), '');
  assert.equal(pieceOf({ tool_calls: [], p: 'abc' }), '', 'an event with no text adds none');
});

/** Replays events the way answer() does, each read against the text so far. */
const replay = (events: unknown[]) => events.reduce<string>((text, e) => text + pieceOf(e, text), '');

test('numbers, true, false and null arrive as JSON values and are read back as text', () => {
  // Recorded from the real endpoint for "z is 3.5; y is null; flag is true":
  // digits come after a space token of their own, the words without their space.
  const events = [
    { response: 'z' }, { response: ' is' }, { response: ' ' }, { response: 3 }, { response: '.' }, { response: 5 },
    { response: ';' }, { response: ' y' }, { response: ' is' }, { response: null },
    { response: ';' }, { response: ' flag' }, { response: ' is' }, { response: true }, { response: '.' },
  ];
  assert.equal(replay(events), 'z is 3.5; y is null; flag is true.');
});

test('a restored word gets no extra space after an opening bracket or quote', () => {
  assert.equal(replay([{ response: 'the test is `' }, { response: false }, { response: '`' }]), 'the test is `false`');
  assert.equal(replay([{ response: 'returns (' }, { response: null }, { response: ')' }]), 'returns (null)');
  assert.equal(replay([{ response: false }]), 'false', 'nothing before it, nothing added');
});

test('an answer streams in, and step numbers in it become links', async () => {
  const sse =
    'data: {"response":"The swap at "}\n\n' +
    'data: {"response":"step 4 put 59 first."}\n\n' +
    'data: {"response":"","usage":{"neurons":40}}\n\ndata: [DONE]\n\n';
  const server = serve(() => new Response(streamOf(sse), { headers: { 'content-type': 'text/event-stream' } }));
  try {
    const out = await collect(provider().answer({ task: 'explain', source: 'x = 42\nprint(x)', step }, new AbortController().signal));
    const text = out.filter((c) => c.type === 'delta').map((c) => (c as { text: string }).text).join('');
    assert.equal(text, 'The swap at step 4 put 59 first.');
    const done = out.at(-1)!;
    assert.equal(done.type, 'done');
    assert.deepEqual(done.type === 'done' && done.explanation.steps, [4]);
    // What went to the server: the task and the facts — never instructions.
    const [{ body }] = server.sent;
    assert.deepEqual(Object.keys(body as object).sort(), ['prompt', 'task']);
    assert.match((body as { prompt: string }).prompt, /WHAT THIS STEP DID/);
  } finally {
    server.restore();
  }
});

test('a refusal from the server is shown in its own words', async () => {
  const server = serve(() => new Response(JSON.stringify({ error: 'slow-down', message: 'Try again in a moment.' }), { status: 429 }));
  try {
    const out = await collect(provider().answer({ task: 'ask', source: 'x = 42', step, question: 'why?' }, new AbortController().signal));
    assert.deepEqual(out, [{ type: 'error', kind: 'engine', message: 'Try again in a moment.' }]);
  } finally {
    server.restore();
  }
});

test('stopping before the server answers is a cancellation, not an error', async () => {
  const server = serve(() => new Response('never read'));
  try {
    const stop = new AbortController();
    stop.abort();
    const out = await collect(provider().answer({ task: 'explain', source: 'x = 42', step }, stop.signal));
    assert.deepEqual(out, [{ type: 'error', kind: 'cancelled', message: 'Stopped.' }]);
  } finally {
    server.restore();
  }
});
