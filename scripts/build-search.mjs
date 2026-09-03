/**
 * Build the search index over the built site, and check it covers it.
 *
 * Runs as `postbuild`, so every path that produces a `dist` produces an index
 * with it — `npm run build`, `npm run verify`, and the deploy that runs verify.
 * The alternative was a separate step in the workflow file, which works until
 * somebody builds without it and ships a site whose search returns nothing for
 * everything. Nothing about that failure is visible from the outside.
 *
 * The guard is the point of the script. Pagefind exits 0 having indexed one
 * page as readily as four hundred, and the two are indistinguishable unless
 * somebody searches for something they know is there. `data-pagefind-body` in
 * the layout is what makes a page indexable, so anything that stops that
 * attribute reaching the HTML — a new layout, a route that renders its own
 * document — silently drops those pages out of the index. Comparing the count
 * against the pages actually built turns that into a failed build.
 */
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const DIST = 'dist';

/** Pages that are not documents and are not expected in the index. */
function indexable(file, html) {
  // The CMS shell: noindexed, no <main>, not a page of the book.
  if (file.includes(`${DIST}${path.sep}admin${path.sep}`)) return false;
  // Astro writes a meta-refresh stub for every configured redirect.
  if (/<meta\s+http-equiv=["']?refresh/i.test(html)) return false;
  return true;
}

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}

try {
  await run('npx', ['pagefind', '--site', DIST, '--quiet'], {
    // Four hundred pages of KaTeX markup take a moment.
    timeout: 5 * 60 * 1000,
  });
} catch (err) {
  console.error(`✗ search index: pagefind failed\n${err.stderr || err.message}`);
  process.exit(1);
}

/* What Pagefind actually indexed, from its own manifest. */
let indexed = 0;
try {
  const entry = JSON.parse(
    await readFile(path.join(DIST, 'pagefind', 'pagefind-entry.json'), 'utf8'),
  );
  indexed = (entry.languages?.en ?? Object.values(entry.languages ?? {})[0])?.page_count ?? 0;
} catch {
  console.error('✗ search index: pagefind wrote no manifest');
  process.exit(1);
}

/* What the site actually has. */
let expected = 0;
const missing = [];
for await (const file of walk(DIST)) {
  const html = await readFile(file, 'utf8');
  if (!indexable(file, html)) continue;
  expected += 1;
  if (!html.includes('data-pagefind-body')) missing.push(file.replace(`${DIST}${path.sep}`, ''));
}

if (missing.length) {
  console.error(
    `✗ search index: ${missing.length} page(s) carry no data-pagefind-body and ` +
      `will never appear in results:\n  ${missing.slice(0, 10).join('\n  ')}` +
      (missing.length > 10 ? `\n  …and ${missing.length - 10} more` : ''),
  );
  process.exit(1);
}

if (indexed < expected) {
  console.error(
    `✗ search index: ${indexed} pages indexed but ${expected} were built. ` +
      'A page missing from the index is a page nobody can find.',
  );
  process.exit(1);
}

console.log(`✓ search: ${indexed} pages indexed`);
