/**
 * Every internal link resolves to something that was built.
 *
 * The cheapest guard on the list, and it found two live 404s the first time it
 * ran. Both were cross-references between marginalia entries, and both failed
 * for the same reason: the files were named
 * `beyond-correlation-a-review-of-pearl’s-causality.mdx` and
 * `the-model-is-fine.-the-framing-wasn-t.mdx`, Astro drops the curly
 * apostrophe and the full stop when it builds the URL, and the links were
 * written from the filename. The pages existed. The addresses did not.
 *
 * That class of bug is invisible from inside the site — nothing renders wrong,
 * no build step complains, and the only way to notice is to click the link.
 * There were 9,560 internal links to click.
 *
 * Checked against `dist` rather than against the content collections, because
 * what matters is whether the address a reader's browser will request was
 * actually written to disk. A link can be correct about a page that exists and
 * still be wrong about where it ended up.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DIST = 'dist';

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}

/** Everything the site serves, by the address it is served at. */
const built = new Set();
for await (const f of walk(DIST)) {
  const rel = f.replace(`${DIST}${path.sep}`, '').split(path.sep).join('/');
  built.add(`/${rel}`);
  if (rel.endsWith('/index.html')) {
    const dir = `/${rel.slice(0, -'/index.html'.length)}`;
    built.add(dir);
    built.add(`${dir}/`);
  }
}
/* Non-HTML assets too: a PDF, an image or the feed is as linkable as a page. */
async function* files(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else yield p;
  }
}
for await (const f of files(DIST)) {
  built.add(`/${f.replace(`${DIST}${path.sep}`, '').split(path.sep).join('/')}`);
}
built.add('/');

function resolves(href) {
  const clean = decodeURIComponent(href.split('#')[0].split('?')[0]);
  if (!clean || clean === '/') return true;
  const bare = clean.replace(/\/+$/, '');
  return (
    built.has(clean) ||
    built.has(bare) ||
    built.has(`${bare}/`) ||
    built.has(`${bare}.html`) ||
    built.has(`${bare}/index.html`)
  );
}

const broken = new Map();
let links = 0;
let pages = 0;

for await (const file of walk(DIST)) {
  // The CMS shell is a third-party bundle and links wherever it likes.
  if (file.includes(`${DIST}${path.sep}admin${path.sep}`)) continue;
  const html = await readFile(file, 'utf8');
  pages += 1;
  const page = file.replace(DIST, '').replace(/\/index\.html$/, '') || '/';

  /* Root-relative only. An external link is somebody else's to keep alive, and
     a relative one is rare enough here that a false positive would cost more
     than the check is worth. */
  for (const m of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    const href = m[1];
    links += 1;
    if (!resolves(href)) {
      if (!broken.has(href)) broken.set(href, new Set());
      broken.get(href).add(page);
    }
  }
}

if (broken.size) {
  console.error(`✗ ${broken.size} internal link(s) point at nothing:`);
  for (const [href, from] of [...broken].sort()) {
    const where = [...from].sort();
    console.error(
      `  ✗ ${href}\n      linked from ${where.length} page(s), e.g. ${where[0]}`,
    );
  }
  process.exit(1);
}

console.log(`✓ links: ${links} internal links across ${pages} pages all resolve`);
