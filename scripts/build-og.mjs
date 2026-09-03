/**
 * Render the social card each built page asks for.
 *
 * Reads the address out of the built HTML rather than enumerating routes. The
 * alternative was a list of every page and its title, kept beside a hundred
 * route files and correct until somebody added the hundred-and-first — and a
 * page missing from that list would not fail anything, it would just quietly
 * go back to sharing the generic card.
 *
 * Here there is nothing to keep in step. A page that renders is a page that
 * names its card, and this renders exactly the file it named. The guard at the
 * end closes the loop: if any page points at a card that does not exist, the
 * build fails rather than shipping a link preview that 404s.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderCard } from './og-card.mjs';

const DIST = 'dist';
const SITE = /^https?:\/\/[^/]+/;

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}

/** Undo the escaping Astro applied when it wrote the attribute. */
const unescape = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function meta(html, key) {
  const m = html.match(new RegExp(`data-pagefind-meta="${key}:([^"]*)"`));
  return m ? unescape(m[1]).trim() : '';
}

const cards = new Map();
let pages = 0;

for await (const file of walk(DIST)) {
  const html = await readFile(file, 'utf8');
  // Redirect stubs carry no card and are not documents.
  if (/<meta\s+http-equiv=["']?refresh/i.test(html)) continue;

  const m = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (!m) continue;
  const url = m[1].replace(SITE, '');
  // A route that set its own image points somewhere else; leave it alone.
  if (!url.startsWith('/og/') || !url.endsWith('.png')) continue;

  pages += 1;
  if (cards.has(url)) continue;

  /* Title and section come from the metadata the layout already emits for the
     search index, so the card, the search result and the page agree by
     construction rather than by three places being edited together. */
  const title = meta(html, 'title') || (html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '').trim();
  const section = meta(html, 'section') || 'Frontispiece';
  if (!title) {
    console.error(`✗ social cards: ${file} has no title to put on a card`);
    process.exit(1);
  }
  cards.set(url, { title: unescape(title), section });
}

let bytes = 0;
for (const [url, spec] of cards) {
  const out = path.join(DIST, url);
  await mkdir(path.dirname(out), { recursive: true });
  const png = await renderCard(spec);
  await writeFile(out, png);
  bytes += png.length;
}

/* The old shared card's address, kept alive and no longer hand-maintained.
   Links shared before this existed still point at /og.png, and social
   platforms cache a preview for a long time; serving the frontispiece's own
   card there keeps those previews working and, more to the point, keeps them
   from being the one image on the site still describing the author the way the
   site described him two months ago. */
const front = cards.get('/og/index.png');
if (front) await writeFile(path.join(DIST, 'og.png'), await renderCard(front));

/* The loop closed: every card a page asked for was written. This can only fail
   if the two halves disagree about the naming scheme, which is exactly the
   thing worth failing a build over — a link preview that 404s looks like a
   dead site, and nothing on the site itself would show it. */
const missing = [];
for (const url of cards.keys()) {
  try {
    await readFile(path.join(DIST, url));
  } catch {
    missing.push(url);
  }
}
if (missing.length) {
  console.error(`✗ social cards: ${missing.length} not written: ${missing.slice(0, 5).join(', ')}`);
  process.exit(1);
}

console.log(
  `✓ social cards: ${cards.size} rendered for ${pages} pages, ` +
    `${(bytes / 1024 / 1024).toFixed(1)} MB`,
);
