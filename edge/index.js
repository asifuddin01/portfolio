/**
 * The site's Worker.
 *
 * Almost nothing reaches it. The site is prerendered pages served straight
 * from ./dist, and wrangler.jsonc sends only three path prefixes here:
 *
 *   /artifacts/private/api/*   the private archive's data — list, add, edit, delete
 *   /artifacts/private/file/*  the archive's files, served so they open anywhere
 *   /api/artifacts/*   the inbox, for adding from a script or from Cowork
 *
 * The first two sit behind Cloudflare Access and check its signed token on
 * every request (edge/access.js says why the path alone is not enough). The
 * inbox is outside Access, because a script cannot sign in with an email
 * code; it takes a key instead, and it can only *add*. Nothing reachable with
 * that key reads, lists, changes or deletes anything already there.
 *
 * Storage is Workers KV. Two keys per artifact:
 *
 *   item:<id>   empty value; everything the list needs lives in its metadata,
 *               so the whole archive lists in one call with no reads
 *   blob:<id>   the file itself, for files (links have no blob)
 *
 * The blob is written before the item, so an item never points at nothing.
 */

import { marked } from 'marked';
import { verifyAccess } from './access.js';

/** KV's ceiling for a single value. */
const MAX_BYTES = 25 * 1024 * 1024;
/** KV's ceiling for a key's metadata, serialised. */
const MAX_META = 1024;
const ID = /^[a-z0-9]{10,32}$/;

/**
 * What a file is shown as, by extension. The browser's `type` is a hint at
 * best (an .md file arrives as "" or application/octet-stream depending on
 * the machine), so the extension decides.
 */
const KINDS = {
  html: ['html', 'text/html; charset=utf-8'],
  htm: ['html', 'text/html; charset=utf-8'],
  svg: ['svg', 'image/svg+xml'],
  png: ['image', 'image/png'],
  jpg: ['image', 'image/jpeg'],
  jpeg: ['image', 'image/jpeg'],
  webp: ['image', 'image/webp'],
  gif: ['image', 'image/gif'],
  avif: ['image', 'image/avif'],
  pdf: ['pdf', 'application/pdf'],
  md: ['markdown', 'text/markdown; charset=utf-8'],
  markdown: ['markdown', 'text/markdown; charset=utf-8'],
  txt: ['text', 'text/plain; charset=utf-8'],
  csv: ['text', 'text/plain; charset=utf-8'],
  tsv: ['text', 'text/plain; charset=utf-8'],
  json: ['text', 'text/plain; charset=utf-8'],
};

/**
 * Every HTML artifact runs its own scripts, and it runs them on this
 * origin — the origin that holds the CMS sign-in. `sandbox` without
 * `allow-same-origin` gives the document an opaque origin of its own, so its
 * scripts work and cannot see anything that belongs to the site. Sent as a
 * header, it holds when the file is opened in a tab of its own, not only
 * inside the viewer's iframe.
 */
const SANDBOX_SCRIPTS =
  'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads';
/** Markdown and plain text need no scripts at all, so they get none. */
const SANDBOX_STATIC =
  "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src * data:; style-src 'unsafe-inline'";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const oops = (status, error, message) => json({ error, message }, status);

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/api/artifacts/inbox') return await inbox(request, env);

      if (pathname.startsWith('/artifacts/private/api/') || pathname.startsWith('/artifacts/private/file/')) {
        const who = await verifyAccess(request, env);
        if (!who.ok) {
          return pathname.startsWith('/artifacts/private/file/')
            ? new Response(`401 — ${who.reason}\n`, {
                status: 401,
                headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
              })
            : oops(401, 'signed-out', who.reason);
        }
        if (pathname.startsWith('/artifacts/private/file/')) return await file(request, env, pathname);
        return await api(request, env, pathname, who);
      }

      return env.ASSETS.fetch(request);
    } catch (err) {
      if (err?.status) return oops(err.status, 'bad-request', err.message);
      console.error(err);
      return oops(500, 'server', String(err?.message ?? err));
    }
  },
};

/* ---------------------------------------------------------------- API ---- */

async function api(request, env, pathname, who) {
  const rest = pathname.slice('/artifacts/private/api/'.length).split('/');
  if (rest[0] !== 'items') return oops(404, 'not-found', 'No such endpoint.');
  const id = rest[1];

  if (!id) {
    if (request.method === 'GET') return json({ user: who.email, items: await list(env) });
    if (request.method === 'POST') return create(request, env);
    return oops(405, 'method', 'GET or POST.');
  }

  if (!ID.test(id)) return oops(404, 'not-found', 'No such artifact.');
  if (rest[2] === 'content') {
    return request.method === 'PUT' ? saveContent(request, env, id) : oops(405, 'method', 'PUT only.');
  }
  if (rest[2] === 'undo') {
    return request.method === 'POST' ? undo(env, id) : oops(405, 'method', 'POST only.');
  }
  if (request.method === 'PATCH') return edit(request, env, id);
  if (request.method === 'DELETE') {
    await env.ARTIFACTS.delete(`item:${id}`);
    await env.ARTIFACTS.delete(`blob:${id}`);
    await env.ARTIFACTS.delete(`prev:${id}`);
    return json({ ok: true });
  }
  return oops(405, 'method', 'PATCH or DELETE.');
}

/** What can be written in the browser: anything stored as text. */
const WRITABLE = new Set(['html', 'markdown', 'text', 'svg']);

/**
 * Replace an artifact's contents with an edited version.
 *
 * The version it replaces is kept as `prev:<id>`, one step deep, so a bad
 * save is one tap from undone. Every save bumps `v`, which the viewer puts in
 * the file's URL: the files are cached as immutable, and without a new URL a
 * browser would keep showing the text from before the edit.
 */
async function saveContent(request, env, id) {
  const { metadata: m } = await env.ARTIFACTS.getWithMetadata(`item:${id}`);
  if (!m) return oops(404, 'not-found', 'No such artifact.');
  if (!WRITABLE.has(m.k)) return oops(400, 'not-editable', 'Only pages, notes, text and SVG can be edited here.');
  let body;
  try {
    body = await request.json();
  } catch {
    return oops(400, 'bad-json', 'The body is not JSON.');
  }
  if (typeof body.content !== 'string' || !body.content.trim()) {
    return oops(400, 'empty', 'There is nothing to save.');
  }
  const bytes = new TextEncoder().encode(body.content);
  if (bytes.length > MAX_BYTES) return tooLarge();

  const old = await env.ARTIFACTS.getWithMetadata(`blob:${id}`, { type: 'arrayBuffer' });
  const blobMeta = old.metadata ?? { k: m.k, m: m.m, n: m.n, t: m.t };
  if (old.value) await env.ARTIFACTS.put(`prev:${id}`, old.value, { metadata: blobMeta });
  await env.ARTIFACTS.put(`blob:${id}`, bytes, { metadata: blobMeta });
  const meta = fit({ ...m, s: bytes.length, v: (m.v ?? 0) + 1, e: new Date().toISOString(), p: old.value ? 1 : m.p });
  await env.ARTIFACTS.put(`item:${id}`, '', { metadata: meta });
  return json(view(id, meta));
}

/** Put back the version from before the last save. One step, then gone. */
async function undo(env, id) {
  const { metadata: m } = await env.ARTIFACTS.getWithMetadata(`item:${id}`);
  if (!m) return oops(404, 'not-found', 'No such artifact.');
  const prev = await env.ARTIFACTS.getWithMetadata(`prev:${id}`, { type: 'arrayBuffer' });
  if (!prev.value) return oops(404, 'nothing', 'There is no earlier version to go back to.');
  await env.ARTIFACTS.put(`blob:${id}`, prev.value, { metadata: prev.metadata });
  await env.ARTIFACTS.delete(`prev:${id}`);
  const meta = fit({ ...m, s: prev.value.byteLength, v: (m.v ?? 0) + 1, e: new Date().toISOString(), p: undefined });
  await env.ARTIFACTS.put(`item:${id}`, '', { metadata: meta });
  return json(view(id, meta));
}

/** The inbox: add-only, behind a key, for scripts that cannot sign in. */
async function inbox(request, env) {
  if (!env.INBOX_KEY) return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return oops(405, 'method', 'POST only.');
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given || !(await sameSecret(given, env.INBOX_KEY))) return oops(403, 'forbidden', 'Wrong key.');
  return create(request, env);
}

/** Constant-time: hash both so the comparison is always of equal length. */
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(x, y);
}

async function list(env) {
  const items = [];
  let cursor;
  do {
    const page = await env.ARTIFACTS.list({ prefix: 'item:', cursor });
    for (const k of page.keys) if (k.metadata) items.push(view(k.name.slice(5), k.metadata));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  items.sort((a, b) => b.added.localeCompare(a.added));
  return items;
}

async function create(request, env) {
  const type = request.headers.get('content-type') ?? '';
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES + 256 * 1024) return tooLarge();

  if (type.includes('application/json')) {
    let body;
    try {
      body = await request.json();
    } catch {
      return oops(400, 'bad-json', 'The body is not JSON.');
    }
    // Pasted code: the artifact's HTML (or Markdown) as text, saved exactly as
    // an uploaded file would be. For the page's paste box, and for anything
    // that has the code in hand and no file to attach.
    if (typeof body.content === 'string') return json(await pasted(env, body), 201);

    const url = cleanUrl(body.url);
    if (!url) return oops(400, 'bad-url', 'A link has to start with http:// or https:// and be under 400 characters.');

    // "Keep a copy": fetch what the link points at and keep it as a file, so
    // it opens here even when the source moves or disappears. When that is
    // not possible the link is kept as a link, and the answer says why.
    let why = null;
    if (body.copy) {
      const got = await fetchCopy(url);
      if (got.ok) {
        const title = text(body.title) || (got.kind === 'html' ? htmlTitle(got.bytes) : '') || titleFromName(got.name);
        const item = await store(env, {
          kind: got.kind,
          mime: got.mime,
          research: body.research,
          title,
          note: body.note,
          name: got.name,
          size: got.bytes.byteLength,
          bytes: got.bytes,
          url,
        });
        return json({ ...item, copied: true }, 201);
      }
      why = got.reason;
    }
    const item = await store(env, {
      kind: 'link',
      research: body.research,
      title: text(body.title) || titleFromUrl(url),
      note: body.note,
      url,
    });
    return json(why ? { ...item, copied: false, reason: why } : item, 201);
  }

  if (type.includes('multipart/form-data')) {
    const form = await request.formData();
    const upload = form.get('file');
    if (!upload || typeof upload === 'string') return oops(400, 'no-file', 'No file in the upload.');
    if (upload.size > MAX_BYTES) return tooLarge();
    if (upload.size === 0) return oops(400, 'empty', `${upload.name} is empty.`);

    const bytes = await upload.arrayBuffer();
    const ext = (upload.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
    const [kind, mime] = KINDS[ext] ?? ['file', 'application/octet-stream'];
    const title =
      text(form.get('title')) || (kind === 'html' ? htmlTitle(bytes) : '') || titleFromName(upload.name);

    const item = await store(env, {
      kind,
      mime,
      research: form.get('research'),
      title,
      note: form.get('note'),
      name: upload.name,
      size: upload.size,
      bytes,
    });
    return json(item, 201);
  }

  return oops(415, 'type', 'Send a file as multipart/form-data, or a link as JSON.');
}

/** Content types a copy can be kept as, when the URL has no telling extension. */
const TYPES = [
  [/^text\/html/, 'html'],
  [/^application\/xhtml/, 'htm'],
  [/^image\/svg/, 'svg'],
  [/^image\/png/, 'png'],
  [/^image\/jpe?g/, 'jpg'],
  [/^image\/webp/, 'webp'],
  [/^image\/gif/, 'gif'],
  [/^image\/avif/, 'avif'],
  [/^application\/pdf/, 'pdf'],
  [/^text\/markdown/, 'md'],
  [/^text\/(plain|csv)/, 'txt'],
  [/^application\/json/, 'json'],
];

/**
 * Download a link's target for keeping. Refuses rather than keeping the
 * wrong thing: a bot check, a sign-in page or an error page saved as "the
 * paper" would be worse than the link it replaced.
 */
async function fetchCopy(url) {
  const no = (reason) => ({ ok: false, reason });
  const host = new URL(url).hostname;
  // claude.ai answers every server with a bot check; there is nothing to
  // fetch, and getting round the check is not something to build.
  if (host === 'claude.ai' || host.endsWith('.claude.ai')) {
    return no(
      "claude.ai doesn't let other servers read artifacts, so this stays a link. For a copy " +
        'that opens here, paste the artifact\'s code into Paste code.',
    );
  }

  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'asifuddin.com archive (keeping a copy for its owner)', accept: '*/*' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return no(`the site did not answer (${err?.name === 'TimeoutError' ? 'timed out' : 'unreachable'}).`);
  }
  if (!res.ok) return no(`the site answered ${res.status}, so there was nothing to keep.`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) return no('the file is over 25 MB, the most a copy can be.');

  // Read with a running count, so an undeclared giant stops at the limit.
  const chunks = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return no('the file is over 25 MB, the most a copy can be.');
    }
    chunks.push(value);
  }
  let bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  if (total === 0) return no('the site sent an empty file.');

  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  const final = new URL(res.url || url);
  const last = decodeURIComponent(final.pathname.split('/').filter(Boolean).pop() ?? '');
  // Only a known extension counts: in "1706.03762" the ".03762" is part of
  // an arXiv id, not a file type.
  const found = (last.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  const urlExt = KINDS[found] ? found : '';
  const ext = urlExt || TYPES.find(([re]) => re.test(type))?.[1];
  if (!ext) return no(`it is a kind of file the archive does not open (${type || 'unknown type'}).`);
  const [kind, mime] = KINDS[ext];

  if (kind === 'html') {
    const head = new TextDecoder().decode(bytes.slice(0, 64 * 1024));
    if (/<title>\s*just a moment|cf-chl|challenge-platform|captcha/i.test(head)) {
      return no('the site answered with a bot check instead of the page.');
    }
    // A page's stylesheets and images are usually relative to where it
    // lives. A <base> pointing back there keeps them loading in the copy.
    const src = new TextDecoder().decode(bytes);
    const base = `<base href="${esc(final.href)}">`;
    const withBase = /<head[^>]*>/i.test(src) ? src.replace(/<head[^>]*>/i, (m) => m + base) : base + src;
    bytes = new TextEncoder().encode(withBase);
  }

  const stem = (urlExt ? last.replace(/\.[^.]+$/, '') : last || final.hostname).replace(/[^\w.-]+/g, '-').slice(0, 80);
  return { ok: true, bytes, kind, mime, name: `${stem || 'copy'}.${ext}` };
}

async function pasted(env, body) {
  const src = body.content;
  if (!src.trim()) throw Object.assign(new Error('There is no code to save.'), { status: 400 });
  const bytes = new TextEncoder().encode(src);
  if (bytes.length > MAX_BYTES) throw Object.assign(new Error('Pasted code is over 25 MB.'), { status: 413 });
  const markdown = body.format === 'markdown';
  const [kind, mime] = markdown ? KINDS.md : KINDS.html;
  const title =
    text(body.title) ||
    (markdown ? src.match(/^#\s+(.+)$/m)?.[1]?.trim() : htmlTitle(bytes)) ||
    (markdown ? 'Pasted notes' : 'Pasted page');
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'pasted';
  return store(env, {
    kind,
    mime,
    research: body.research,
    title,
    note: body.note,
    name: `${slug}.${markdown ? 'md' : 'html'}`,
    size: bytes.length,
    bytes,
  });
}

async function edit(request, env, id) {
  const current = await env.ARTIFACTS.getWithMetadata(`item:${id}`);
  if (!current.metadata) return oops(404, 'not-found', 'No such artifact.');
  let body;
  try {
    body = await request.json();
  } catch {
    return oops(400, 'bad-json', 'The body is not JSON.');
  }
  const m = { ...current.metadata };
  if ('research' in body) m.r = clean(body.research, 60) || 'Unsorted';
  if ('title' in body) m.t = clean(body.title, 140) || m.t;
  if ('note' in body) m.o = clean(body.note, 280) || undefined;
  const meta = fit(m);
  await env.ARTIFACTS.put(`item:${id}`, '', { metadata: meta });
  return json(view(id, meta));
}

async function store(env, x) {
  const id = Date.now().toString(36) + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  const meta = fit({
    r: clean(x.research, 60) || 'Unsorted',
    t: clean(x.title, 140) || 'Untitled',
    k: x.kind,
    n: x.name ? clean(x.name, 100) : undefined,
    m: x.mime,
    s: x.size,
    a: new Date().toISOString(),
    u: x.url,
    o: clean(x.note, 280) || undefined,
  });
  if (x.bytes) {
    await env.ARTIFACTS.put(`blob:${id}`, x.bytes, { metadata: { k: meta.k, m: meta.m, n: meta.n, t: meta.t } });
  }
  await env.ARTIFACTS.put(`item:${id}`, '', { metadata: meta });
  return view(id, meta);
}

const view = (id, m) => ({
  id,
  research: m.r,
  title: m.t,
  kind: m.k,
  name: m.n ?? null,
  type: m.m ?? null,
  size: m.s ?? null,
  added: m.a,
  url: m.u ?? null,
  note: m.o ?? null,
  version: m.v ?? 0,
  edited: m.e ?? null,
  canUndo: !!m.p,
});

/**
 * Metadata has a hard 1 KB ceiling, counted in bytes — and a title in
 * Bengali is three bytes a letter. Trim the note first, then the title,
 * rather than failing the upload over a caption.
 */
function fit(meta) {
  const size = (m) => new TextEncoder().encode(JSON.stringify(m)).length;
  const m = { ...meta };
  while (size(m) > MAX_META - 24 && m.o) m.o = m.o.length > 20 ? m.o.slice(0, -20) + '…' : undefined;
  while (size(m) > MAX_META - 24 && m.t.length > 24) m.t = m.t.slice(0, -12) + '…';
  return m;
}

const tooLarge = () =>
  oops(413, 'too-large', 'Files are kept whole in Workers KV, which holds up to 25 MB each.');

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const clean = (v, max) => text(v).replace(/\s+/g, ' ').slice(0, max);

function cleanUrl(v) {
  const s = text(v);
  if (!s || s.length > 400) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function titleFromUrl(url) {
  const u = new URL(url);
  if (u.hostname === 'claude.ai' && u.pathname.startsWith('/artifact')) return 'Claude artifact';
  return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : '');
}

function titleFromName(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return base ? base[0].toUpperCase() + base.slice(1) : name;
}

function htmlTitle(bytes) {
  const head = new TextDecoder().decode(bytes.slice(0, 256 * 1024));
  const raw = head.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1];
  return raw ? decodeEntities(raw).replace(/\s+/g, ' ').trim() : '';
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* --------------------------------------------------------------- files ---- */

async function file(request, env, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return oops(405, 'method', 'GET only.');
  const id = pathname.slice('/artifacts/private/file/'.length).split('/')[0];
  if (!ID.test(id)) return new Response('Not found', { status: 404 });

  const url = new URL(request.url);
  const raw = url.searchParams.has('raw');
  const download = url.searchParams.has('download');

  const { value, metadata: m } = await env.ARTIFACTS.getWithMetadata(`blob:${id}`, { type: 'arrayBuffer' });
  if (!value || !m) return new Response('Not found', { status: 404 });

  const headers = new Headers({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // The viewer on /artifacts frames these; nobody else may.
    'X-Frame-Options': 'SAMEORIGIN',
    // An id is never reused, so the bytes behind it never change. `private`
    // keeps them in the owner's browser and out of any shared cache.
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(m.n ?? id)}`,
  });

  if (m.k === 'markdown' && !raw && !download) {
    const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : url.searchParams.get('theme') === 'light' ? 'light' : 'auto';
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Content-Security-Policy', SANDBOX_STATIC);
    headers.set('Content-Disposition', 'inline');
    return new Response(renderMarkdown(new TextDecoder().decode(value), m.t ?? 'Notes', theme), { headers });
  }

  const type = m.k === 'markdown' || m.k === 'text' ? 'text/plain; charset=utf-8' : m.m ?? 'application/octet-stream';
  headers.set('Content-Type', type);
  if (m.k === 'html' || m.k === 'svg') headers.set('Content-Security-Policy', SANDBOX_SCRIPTS);
  else if (m.k === 'markdown' || m.k === 'text') headers.set('Content-Security-Policy', SANDBOX_STATIC);
  else if (m.k === 'file') {
    headers.set('Content-Security-Policy', SANDBOX_STATIC);
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(m.n ?? id)}`);
  }
  // PDFs get no sandbox: Chrome will not start its viewer in a sandboxed
  // document, and the viewer runs no script from the file on this origin.
  return new Response(request.method === 'HEAD' ? null : value, { headers });
}

/**
 * A markdown file, set as a page. Rendered here rather than in the viewer so
 * it reads the same in the archive's frame and in a tab of its own. The page
 * runs no script at all (see SANDBOX_STATIC), so raw HTML inside the markdown
 * is displayed as written and never executed.
 */
function renderMarkdown(src, title, theme) {
  const body = marked.parse(src, { gfm: true, async: false });
  const light = '--paper:#efe9d8;--ink:#23201b;--soft:#5d564b;--rule:#c9b98f;--accent:#7a3b2e;--code:#e5dcc6;';
  const dark = '--paper:#15130f;--ink:#e8e0cc;--soft:#a79d8a;--rule:#4a4130;--accent:#d6a17c;--code:#221e17;';
  const palette =
    theme === 'dark'
      ? `:root{${dark}}`
      : theme === 'light'
        ? `:root{${light}}`
        : `:root{${light}}@media (prefers-color-scheme:dark){:root{${dark}}}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><base target="_blank">
<style>${palette}
*{box-sizing:border-box}
html{background:var(--paper);color:var(--ink)}
body{margin:0;padding:clamp(1.25rem,5vw,3.5rem) 16px 4rem;font:1.12rem/1.62 "EB Garamond",Garamond,"Iowan Old Style",Georgia,serif}
main{max-width:42rem;margin:0 auto}
h1,h2,h3,h4{font-family:"Bodoni Moda","Didot","Bodoni 72",Georgia,serif;font-weight:500;line-height:1.15;margin:2rem 0 .7rem}
h1{font-size:2.1rem;margin-top:0}h2{font-size:1.55rem}h3{font-size:1.25rem}
a{color:var(--accent)}
p,ul,ol,blockquote,table,pre{margin:0 0 1rem}
blockquote{margin-left:0;padding-left:1rem;border-left:2px solid var(--rule);color:var(--soft)}
code{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:.84em;background:var(--code);padding:.08em .3em}
pre{background:var(--code);padding:.9rem 1rem;overflow-x:auto}pre code{background:none;padding:0}
table{border-collapse:collapse;display:block;overflow-x:auto}
th,td{border-bottom:1px solid var(--rule);padding:.35rem .7rem;text-align:left;vertical-align:top}
th{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);font-weight:400}
img{max-width:100%;height:auto}
hr{border:0;border-top:1px solid var(--rule);margin:2rem 0}
</style></head><body><main>${body}</main></body></html>`;
}
