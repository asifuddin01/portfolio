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

/** Our own origin; a self-referential canonical tag is not "external". */
const SITE_ORIGIN = 'https://mdasifuddin.com';

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

  // Nothing may LOAD from another origin. Outbound <a href> links are fine
  // and expected — a review that cites a paper should link to it — so only
  // resource-loading attributes are checked, not every absolute URL.
  const loaders = [
    /<script\b[^>]*\ssrc="(https?:\/\/[^"]+)"/gi,
    /<link\b[^>]*\shref="(https?:\/\/[^"]+)"/gi,
    /<img\b[^>]*\ssrc="(https?:\/\/[^"]+)"/gi,
    /<iframe\b[^>]*\ssrc="(https?:\/\/[^"]+)"/gi,
    /<(?:video|audio|source|embed)\b[^>]*\ssrc="(https?:\/\/[^"]+)"/gi,
  ];
  for (const re of loaders) {
    for (const m of html.matchAll(re)) {
      // rel=canonical/alternate/sitemap point at our own site by design
      if (/rel="(?:canonical|alternate|sitemap)"/i.test(m[0])) continue;
      if (m[1].startsWith(SITE_ORIGIN)) continue;
      problems.push(`${page}  external subresource: ${m[1]}`);
    }
  }

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
