/**
 * Sharing one artifact, by a link and a six-digit passkey, with someone who
 * cannot sign in to the archive.
 *
 * The owner makes a share from the archive, behind Access. The link is
 *
 *   https://asifuddin.com/artifacts/shared#<token>
 *
 * with 128 random bits after the #. A browser never sends what follows the #
 * to any server, so the token is in no request line, no log and no Referer.
 * The page posts it, with the passkey, to /api/share/unlock.
 *
 * Each share is one Durable Object, named by a hash of its token (`pub`). The
 * object holds the artifact's id, the passkey's salted hash and the count of
 * wrong passkeys. No API returns the hash and it is not in KV. A Durable
 * Object is one instance worldwide that handles its requests in turn, so the
 * count is exact. KV is eventually consistent: a burst of parallel guesses
 * sent through many Cloudflare locations would all read "no wrong tries yet".
 * A try is counted before the passkey is checked and given back only when the
 * passkey was right, so no interleaving of requests wins an extra guess. Five
 * wrong and the link is locked for good, and the owner makes a new one. That
 * is five guesses in a million, for someone who already has the link.
 *
 * The hash is not a slow one (PBKDF2, scrypt). There are only a million
 * six-digit codes, and an offline search through any hash of them takes
 * seconds. What protects the passkey is that the hash never leaves the object
 * and the object allows five tries. A slow hash would add CPU time and no
 * protection.
 *
 * A right passkey returns a session: a random value whose hash the object
 * keeps for twelve hours, never past the share's expiry. It goes back as an
 * HttpOnly, Secure, SameSite=Strict cookie scoped to that one share's file
 * path, so the file's URL on its own opens nothing, and a page's scripts
 * cannot read the cookie.
 */

import { weakPasskey } from '../src/lib/passkey.js';

const MAX_WRONG = 5;
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 20;
const DAYS = new Set([1, 7, 30, 0]);
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const PUB = /^[A-Za-z0-9_-]{22}$/;

const enc = new TextEncoder();
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));

/** The public name of a share: a hash of its token, which it cannot be turned back into. */
export const pubOf = async (token) => (await sha(`share:${token}`)).slice(0, 22);

async function passkeyHash(salt, code) {
  const key = await crypto.subtle.importKey('raw', unb64url(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(code));
}

/* ------------------------------------------------------ the share object ---- */

export class ShareGate {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    // One load per instance, shared by every request that arrives meanwhile:
    // two loads racing could each hold their own copy, and an increment made
    // to one would be lost when the other replaced it.
    await (this.loading ??= this.storage.get('s').then((v) => {
      this.s = v ?? null;
    }));
    const a = await request.json();
    switch (a.op) {
      case 'create': return Response.json(await this.create(a));
      case 'status': return Response.json(this.status(a.now));
      case 'unlock': return Response.json(await this.unlock(a.code, a.now));
      case 'session': return Response.json(await this.session(a.session, a.now));
      case 'revoke': return Response.json(await this.revoke());
      default: return Response.json({ error: 'op' }, { status: 400 });
    }
  }

  save() {
    return this.storage.put('s', this.s);
  }

  async create({ artifact, code, expires, now }) {
    if (this.s) return { ok: false };
    const salt = random(16);
    this.s = { artifact, salt, hash: b64url(await passkeyHash(salt, code)), created: now, expires, wrong: 0, opened: 0, sessions: [] };
    await this.save();
    return { ok: true };
  }

  state(now) {
    if (!this.s) return 'gone';
    if (this.s.expires && now >= this.s.expires) return 'expired';
    if (this.s.wrong >= MAX_WRONG) return 'locked';
    return 'open';
  }

  status(now) {
    const s = this.s;
    return { state: this.state(now), left: s ? Math.max(0, MAX_WRONG - s.wrong) : 0, opened: s?.opened ?? 0, last: s?.last ?? null };
  }

  async unlock(code, now) {
    const state = this.state(now);
    if (state !== 'open') return { status: state === 'locked' ? 'locked' : 'gone' };
    const s = this.s;
    // Counted before the check, with no await in between: a request that
    // arrives while this one is hashing already sees the try as spent.
    s.wrong += 1;
    await this.save();
    const right = crypto.subtle.timingSafeEqual(await passkeyHash(s.salt, code), unb64url(s.hash));
    if (!right) return { status: 'wrong', left: Math.max(0, MAX_WRONG - s.wrong) };

    s.wrong -= 1;
    s.opened += 1;
    s.last = now;
    const session = random(32);
    const until = s.expires ? Math.min(now + SESSION_MS, s.expires) : now + SESSION_MS;
    s.sessions = [...s.sessions.filter((x) => x.until > now), { h: await sha(session), until }].slice(-MAX_SESSIONS);
    await this.save();
    return { status: 'ok', artifact: s.artifact, session, until };
  }

  /**
   * A session outlives a lock: the lock answers guessing, and whoever holds a
   * session already knew the passkey. Withdrawing the link ends them all.
   */
  async session(session, now) {
    const state = this.state(now);
    if (typeof session !== 'string' || state === 'gone' || state === 'expired') return {};
    const h = await sha(session);
    return this.s.sessions.some((x) => x.h === h && x.until > now) ? { artifact: this.s.artifact } : {};
  }

  async revoke() {
    this.s = null;
    await this.storage.deleteAll();
    return { ok: true };
  }
}

const gate = async (env, pub, body) => {
  const stub = env.SHARES.get(env.SHARES.idFromName(pub));
  const res = await stub.fetch('https://share.gate/', { method: 'POST', body: JSON.stringify({ now: Date.now(), ...body }) });
  return res.json();
};

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
const oops = (status, error, message, extra = {}) => json({ error, message, ...extra }, status);

const linkFor = (request, token) => `${new URL(request.url).origin}/artifacts/shared#${token}`;

/* --------------------------------------------------- the owner's side ---- */

/**
 * GET lists an artifact's links, POST makes one, DELETE …/<pub> withdraws one.
 * Called only after edge/access.js has verified the owner's sign-in.
 *
 * KV keeps an index, `share:<id>:<pub>`, so the archive can list an
 * artifact's links and copy one again. It holds the link and its dates, never
 * the passkey: everything that decides whether a link opens is in the object.
 */
export async function shares(request, env, id, pub) {
  if (!env.SHARES) return oops(503, 'unavailable', 'Sharing is not switched on for this deployment.');
  const { metadata: item } = await env.ARTIFACTS.getWithMetadata(`item:${id}`);
  if (!item) return oops(404, 'not-found', 'No such artifact.');

  if (pub) {
    if (request.method !== 'DELETE') return oops(405, 'method', 'DELETE only.');
    if (!PUB.test(pub)) return oops(404, 'not-found', 'No such link.');
    await withdraw(env, id, pub);
    return json({ ok: true });
  }

  if (request.method === 'GET') {
    const page = await env.ARTIFACTS.list({ prefix: `share:${id}:` });
    const out = await Promise.all(
      page.keys.map(async (k) => {
        const p = k.name.split(':')[2];
        return { pub: p, link: linkFor(request, k.metadata.k), created: k.metadata.c, expires: k.metadata.x ?? null, ...(await gate(env, p, { op: 'status' })) };
      }),
    );
    return json({ shares: out.sort((a, b) => b.created - a.created) });
  }

  if (request.method === 'POST') {
    if (item.k === 'link') return oops(400, 'link', 'A link can be sent as it is. Sharing with a passkey is for files and pages kept here.');
    let body;
    try {
      body = await request.json();
    } catch {
      return oops(400, 'bad-json', 'The body is not JSON.');
    }
    const code = typeof body.code === 'string' ? body.code : '';
    const weak = weakPasskey(code);
    if (weak) return oops(400, 'weak', weak);
    const days = Number(body.days);
    if (!DAYS.has(days)) return oops(400, 'days', 'A link works for 1, 7 or 30 days, or until withdrawn.');

    const token = random(16);
    const p = await pubOf(token);
    const now = Date.now();
    const expires = days ? now + days * 86_400_000 : null;
    const made = await gate(env, p, { op: 'create', artifact: id, code, expires });
    if (!made.ok) return oops(500, 'server', 'The link could not be made. Try again.');
    await env.ARTIFACTS.put(`share:${id}:${p}`, '', { metadata: { k: token, c: now, x: expires ?? undefined } });
    return json({ pub: p, link: linkFor(request, token), created: now, expires, state: 'open', left: MAX_WRONG, opened: 0, last: null }, 201);
  }

  return oops(405, 'method', 'GET or POST.');
}

async function withdraw(env, id, pub) {
  await gate(env, pub, { op: 'revoke' });
  await env.ARTIFACTS.delete(`share:${id}:${pub}`);
}

/** Every link to an artifact goes when the artifact does. */
export async function withdrawAll(env, id) {
  if (!env.SHARES) return;
  const page = await env.ARTIFACTS.list({ prefix: `share:${id}:` });
  await Promise.all(page.keys.map((k) => withdraw(env, id, k.name.split(':')[2])));
}

/* ------------------------------------------------- the recipient's side ---- */

/**
 * POST /api/share/unlock { token, code }. Answers with nothing about the
 * artifact, not even its title, until the passkey is right.
 */
export async function unlock(request, env) {
  if (request.method !== 'POST') return oops(405, 'method', 'POST only.');
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return oops(403, 'cross-origin', 'This answers this site only.');
  if (!env.SHARES) return oops(503, 'unavailable', 'Sharing is not switched on for this deployment.');

  // A second guard in front of the count: it stops one visitor hammering the
  // objects, and slows anyone working through many links at once.
  if (env.SHARE_RATE) {
    const { success } = await env.SHARE_RATE.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
    if (!success) return oops(429, 'slow-down', 'Too many tries from here. Wait a minute and try again.');
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return oops(400, 'bad-json', 'The body is not JSON.');
  }
  const { token, code } = body ?? {};
  if (typeof token !== 'string' || !TOKEN.test(token)) {
    return oops(404, 'gone', 'This link is incomplete. Copy the whole link, including everything after the #.');
  }
  // Not six digits is a typing slip, not a guess, so it is not counted.
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return oops(400, 'format', 'The passkey is six digits.');

  const pub = await pubOf(token);
  const r = await gate(env, pub, { op: 'unlock', code });
  if (r.status === 'locked') {
    return oops(423, 'locked', 'This link is locked after too many wrong passkeys. Ask for a new link.');
  }
  if (r.status === 'wrong') {
    return oops(401, 'wrong', r.left ? `That passkey is not right. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left before the link locks.` : 'That passkey is not right, and the link is now locked. Ask for a new link.', { left: r.left });
  }
  const { metadata: m } = r.status === 'ok' ? await env.ARTIFACTS.getWithMetadata(`item:${r.artifact}`) : {};
  if (r.status !== 'ok' || !m) return oops(404, 'gone', 'This link has expired or been withdrawn.');

  const cookie = [
    `sh_${pub}=${r.session}`,
    `Path=/api/share/file/${pub}/`,
    `Max-Age=${Math.max(1, Math.floor((r.until - Date.now()) / 1000))}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ');
  return json(
    { pub, title: m.t, kind: m.k, name: m.n ?? null, size: m.s ?? null, version: m.v ?? 0, until: r.until },
    200,
    { 'Set-Cookie': cookie },
  );
}

/** The artifact a request to /api/share/file/<pub>/… may see, or null. */
export async function sharedArtifact(request, env, pub) {
  if (!env.SHARES || !PUB.test(pub)) return null;
  const want = `sh_${pub}`;
  const session = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((p) => p.trim().split('='))
    .find(([k]) => k === want)?.[1];
  if (!session) return null;
  const r = await gate(env, pub, { op: 'session', session });
  return r.artifact ?? null;
}
