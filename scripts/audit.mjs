/** Static audit of the built output: heading order, landmarks, alt text,
    and any request that would leave the origin. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}

let fail = 0;
const problems = [];

for await (const file of walk('dist')) {
  // /admin is the CMS shell, not a page of the book: no <main>, no h1,
  // and it is noindexed. The public-site rules do not apply to it.
  if (file.includes(`dist${path.sep}admin${path.sep}`)) continue;

  const html = await readFile(file, 'utf8');
  const page = file.replace(/^dist/, '').replace(/index\.html$/, '') || '/';

  // one h1, no skipped levels
  const heads = [...html.matchAll(/<h([1-6])[^>]*>/g)].map((m) => Number(m[1]));
  const h1s = heads.filter((h) => h === 1).length;
  if (h1s !== 1) problems.push(`${page}  h1 count = ${h1s} (expected 1)`);
  let prev = 0;
  for (const h of heads) {
    if (prev && h > prev + 1) { problems.push(`${page}  heading jump h${prev} → h${h}`); break; }
    prev = h;
  }

  // images must carry alt
  for (const tag of html.match(/<img[^>]*>/g) ?? []) {
    if (!/\salt=/.test(tag)) problems.push(`${page}  <img> without alt: ${tag.slice(0, 70)}`);
  }

  // language + landmarks
  if (!/<html[^>]+lang=/.test(html)) problems.push(`${page}  <html> missing lang`);
  if (!/<main/.test(html)) problems.push(`${page}  no <main> landmark`);

  // nothing may leave the origin (fonts, scripts, styles, images)
  const ext = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/schema\.org|artic\.edu|github\.com|linkedin\.com|mdasifuddin\.com/.test(u));
  for (const u of ext) problems.push(`${page}  external subresource: ${u}`);

  if (/fonts\.googleapis|fonts\.gstatic|use\.typekit/.test(html)) {
    problems.push(`${page}  NETWORK FONT REQUEST`);
  }
}

if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log('  ✗ ' + p);
  fail = 1;
} else {
  console.log('✓ headings, alt text, landmarks, lang and self-hosting all clean');
}
process.exit(fail);
