/**
 * The archive's Worker, exercised without Cloudflare.
 *
 * What matters most here is the gate, so most of these are refusals: a
 * request with no Access token, a forged one, an expired one, one issued for
 * another application. Each must get a 401 and no data. The rest check that a
 * signed-in owner can add, list, edit, open and delete, and that an HTML
 * artifact is served sandboxed away from the site's origin.
 *
 *   node --test edge/
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, webcrypto, timingSafeEqual } from 'node:crypto';

// Workers ship this; Node does not.
webcrypto.subtle.timingSafeEqual ??= (a, b) =>
  a.byteLength === b.byteLength && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const { default: worker } = await import('./index.js');

const TEAM = 'test-team.cloudflareaccess.com';
const AUD = 'aud-for-the-cv-editor';

const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...signer.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const CERTS = `data:application/json,${encodeURIComponent(JSON.stringify({ keys: [jwk] }))}`;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function token(claims = {}, { key = signer.privateKey, kid = 'k1' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64({ aud: [AUD], iss: `https://${TEAM}`, email: 'owner@example.com', iat: now, nbf: now, exp: now + 600, ...claims });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

/** Workers KV, as far as the Worker uses it — including the 1 KB metadata limit. */
class KV {
  m = new Map();
  async put(k, v, o = {}) {
    if (o.metadata && Buffer.byteLength(JSON.stringify(o.metadata)) > 1024) {
      throw new Error('KV PUT failed: metadata over 1024 bytes');
    }
    this.m.set(k, { v, meta: o.metadata ?? null });
  }
  async getWithMetadata(k) {
    const e = this.m.get(k);
    return e ? { value: e.v, metadata: e.meta } : { value: null, metadata: null };
  }
  async delete(k) {
    this.m.delete(k);
  }
  async list({ prefix }) {
    const keys = [...this.m].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.meta }));
    return { keys, list_complete: true };
  }
}

let env;
before(() => {
  env = {
    ARTIFACTS: new KV(),
    ASSETS: { fetch: async () => new Response('static', { status: 200 }) },
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ACCESS_CERTS_URL: CERTS,
    INBOX_KEY: 'inbox-key-for-tests',
  };
});

const call = (path, init = {}, jwt = token()) =>
  worker.fetch(
    new Request(`https://asifuddin.com${path}`, {
      ...init,
      headers: { ...(jwt ? { 'cf-access-jwt-assertion': jwt } : {}), ...(init.headers ?? {}) },
    }),
    env,
  );

const upload = (name, body, fields = {}) => {
  const form = new FormData();
  form.set('file', new File([body], name));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return { method: 'POST', body: form };
};

/* --- the gate ----------------------------------------------------------- */

test('no Access token: 401, and the reason says what to fix', async () => {
  const res = await call('/artifacts/private/api/items', {}, null);
  assert.equal(res.status, 401);
  assert.match((await res.json()).message, /Access/);
});

test('a token signed by anyone else is refused', async () => {
  const res = await call('/artifacts/private/api/items', {}, token({}, { key: stranger.privateKey }));
  assert.equal(res.status, 401);
});

test('an expired sign-in is refused', async () => {
  const past = Math.floor(Date.now() / 1000) - 3600;
  assert.equal((await call('/artifacts/private/api/items', {}, token({ exp: past }))).status, 401);
});

test('a token for another Access application is refused', async () => {
  const res = await call('/artifacts/private/api/items', {}, token({ aud: ['some-other-app'] }));
  assert.equal(res.status, 401);
  assert.match((await res.json()).message, /different Access application/);
});

test('a token from another team is refused', async () => {
  assert.equal((await call('/artifacts/private/api/items', {}, token({ iss: 'https://evil.cloudflareaccess.com' }))).status, 401);
});

test('files are behind the same gate as the list', async () => {
  const made = await (await call('/artifacts/private/api/items', upload('secret.md', '# kappa 0.713 unpublished'))).json();
  const res = await call(`/artifacts/private/file/${made.id}`, {}, null);
  assert.equal(res.status, 401);
  assert.doesNotMatch(await res.text(), /0\.713/);
});

test('everything outside the archive falls through to the static site', async () => {
  assert.equal(await (await call('/tabulae', {}, null)).text(), 'static');
});

/* --- the owner ---------------------------------------------------------- */

test('an HTML artifact takes its <title>, and is served in a sandbox', async () => {
  const html = '<!doctype html><title>HCGT-PG Blueprint</title><script>localStorage.x=1</script>';
  const made = await (await call('/artifacts/private/api/items', upload('blueprint.html', html, { research: 'HCGT-PG' }))).json();
  assert.equal(made.title, 'HCGT-PG Blueprint');
  assert.equal(made.kind, 'html');
  assert.equal(made.research, 'HCGT-PG');

  const res = await call(`/artifacts/private/file/${made.id}/blueprint.html`);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /sandbox allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin/, 'same-origin would hand the artifact the site');
  assert.equal(await res.text(), html);
});

test('markdown is set as a page that can run no script at all', async () => {
  const md = '# Notes\n\nKappa was **0.71**.\n\n<script>alert(1)</script>';
  const made = await (await call('/artifacts/private/api/items', upload('notes.md', md, { research: 'CiteProof' }))).json();
  const res = await call(`/artifacts/private/file/${made.id}`);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /^sandbox /);
  assert.doesNotMatch(csp, /allow-scripts/);
  assert.match(await res.text(), /<strong>0\.71<\/strong>/);
  const raw = await call(`/artifacts/private/file/${made.id}?raw`);
  assert.equal(await raw.text(), md);
});

test('a link is kept with its research, and a claude.ai link is named for what it is', async () => {
  const res = await call('/artifacts/private/api/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ research: 'HCGT-PG', url: 'https://claude.ai/artifact/Kg7a2XauQREaXSQHAqf1wD' }),
  });
  assert.equal(res.status, 201);
  const made = await res.json();
  assert.equal(made.kind, 'link');
  assert.equal(made.title, 'Claude artifact');
});

const paste = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('pasted HTML is saved as a page, titled from its <title>', async () => {
  const html = '<!doctype html><title>Pasted Blueprint</title><h1>Stage 2</h1>';
  const made = await (await call('/artifacts/private/api/items', paste({ research: 'HCGT-PG', content: html }))).json();
  assert.equal(made.kind, 'html');
  assert.equal(made.title, 'Pasted Blueprint');
  assert.equal(made.name, 'pasted-blueprint.html');
  const res = await call(`/artifacts/private/file/${made.id}`);
  assert.match(res.headers.get('content-security-policy'), /^sandbox allow-scripts/);
  assert.equal(await res.text(), html);
});

test('pasted Markdown is saved as notes, titled from its first heading', async () => {
  const made = await (await call('/artifacts/private/api/items', paste({ research: 'CiteProof', content: '# Kappa plan\n\nTwenty pairs.', format: 'markdown' }))).json();
  assert.equal(made.kind, 'markdown');
  assert.equal(made.title, 'Kappa plan');
});

test('an empty paste is refused, not saved', async () => {
  const res = await call('/artifacts/private/api/items', paste({ research: 'X', content: '   ' }));
  assert.equal(res.status, 400);
});

test('the inbox takes pasted code as well as files', async () => {
  const res = await call('/api/artifacts/inbox', {
    ...paste({ research: 'HCGT-PG', content: '<title>From Cowork, pasted</title>' }),
    headers: { 'content-type': 'application/json', authorization: 'Bearer inbox-key-for-tests' },
  }, null);
  assert.equal(res.status, 201);
  assert.equal((await res.json()).title, 'From Cowork, pasted');
});

test('a link that is not http(s) is refused', async () => {
  const res = await call('/artifacts/private/api/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ research: 'X', url: 'javascript:alert(1)' }),
  });
  assert.equal(res.status, 400);
});

test('the list carries every artifact, newest first, with the signed-in email', async () => {
  const body = await (await call('/artifacts/private/api/items')).json();
  assert.equal(body.user, 'owner@example.com');
  assert.ok(body.items.length >= 3);
  const dates = body.items.map((i) => i.added);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test('an SVG opened on its own runs sandboxed too', async () => {
  const made = await (await call('/artifacts/private/api/items', upload('plot.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))).json();
  const res = await call(`/artifacts/private/file/${made.id}`);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  assert.match(res.headers.get('content-security-policy'), /^sandbox /);
  assert.doesNotMatch(res.headers.get('content-security-policy'), /allow-same-origin/);
});

test('an artifact can be moved to another research and renamed', async () => {
  const made = await (await call('/artifacts/private/api/items', upload('fig.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'))).json();
  assert.equal(made.research, 'Unsorted');
  const res = await call(`/artifacts/private/api/items/${made.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ research: 'HCGT-PG', title: 'Figure 1' }),
  });
  const edited = await res.json();
  assert.equal(edited.research, 'HCGT-PG');
  assert.equal(edited.title, 'Figure 1');
});

test('delete removes the item and its file', async () => {
  const made = await (await call('/artifacts/private/api/items', upload('gone.txt', 'bye'))).json();
  assert.equal((await call(`/artifacts/private/api/items/${made.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/artifacts/private/file/${made.id}`)).status, 404);
  const ids = (await (await call('/artifacts/private/api/items')).json()).items.map((i) => i.id);
  assert.ok(!ids.includes(made.id));
});

test('a long title in Bengali still fits KV\'s 1 KB of metadata', async () => {
  const title = 'গবেষণা '.repeat(80);
  const note = 'নোট '.repeat(100);
  const res = await call('/artifacts/private/api/items', upload('long.md', 'x', { title, note }));
  assert.equal(res.status, 201);
});

/* --- the inbox ---------------------------------------------------------- */

test('the inbox adds with the right key', async () => {
  const res = await call('/api/artifacts/inbox', {
    ...upload('from-cowork.html', '<title>From Cowork</title>', { research: 'HCGT-PG' }),
    headers: { authorization: 'Bearer inbox-key-for-tests' },
  }, null);
  assert.equal(res.status, 201);
  assert.equal((await res.json()).title, 'From Cowork');
});

test('the inbox refuses a wrong key', async () => {
  const res = await call('/api/artifacts/inbox', {
    ...upload('x.html', 'x'),
    headers: { authorization: 'Bearer nope' },
  }, null);
  assert.equal(res.status, 403);
});

test('the inbox cannot read', async () => {
  const res = await call('/api/artifacts/inbox', { headers: { authorization: 'Bearer inbox-key-for-tests' } }, null);
  assert.equal(res.status, 405);
});

test('with no key configured, the inbox does not exist', async () => {
  const saved = env.INBOX_KEY;
  delete env.INBOX_KEY;
  try {
    const res = await call('/api/artifacts/inbox', upload('x.html', 'x'), null);
    assert.equal(res.status, 404);
  } finally {
    env.INBOX_KEY = saved;
  }
});
