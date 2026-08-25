/**
 * Checks every image embedded in the body of a content file.
 *
 * Two failures put a broken picture on a published page, and neither one is
 * visible to the person who made it:
 *
 *   1. A hotlinked address. Images pasted out of a chat, a search result or a
 *      private gallery carry a signed URL that stops resolving within hours.
 *      The editor sees the picture while writing and a 403 after publishing.
 *      The audit does catch these, but only after a full build, and by then
 *      the message is a wall of URL.
 *   2. A path that does not resolve. A file renamed or removed on disk leaves
 *      the reference behind. Astro fails the build for this one, several
 *      hundred lines away from anything readable.
 *
 * Running before the build turns both into one line naming the file, the line
 * number, and what to do instead.
 *
 * Only the body is examined. Frontmatter images go through the collection
 * schema, which already resolves them.
 */
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

const CONTENT = 'src/content';
const PUBLIC = 'public';

const walk = async (dir) => {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.mdx?$/.test(e.name)) out.push(p);
  }
  return out;
};

const exists = async (p) => {
  try { await access(p); return true; } catch { return false; }
};

/** Frontmatter out, fenced code out — what is left is prose the reader sees. */
const bodyLines = (raw) => {
  const lines = raw.split('\n');
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const close = lines.indexOf('---', 1);
    if (close !== -1) start = close + 1;
  }
  let fenced = false;
  return lines.map((line, i) => {
    if (i < start) return '';
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return ''; }
    return fenced ? '' : line;
  });
};

/** Markdown embeds and literal <img> tags. JSX expressions cannot be resolved
 *  from here, so a src={…} is the component's problem, not this one's. */
const embedsIn = (line) => [
  ...[...line.matchAll(/!\[([^\]]*)\]\(\s*(?:<([^>]*)>|([^\s)]+))[^)]*\)/g)]
    .map((m) => ({ alt: m[1], src: m[2] ?? m[3] })),
  ...[...line.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)]
    .map((m) => ({ alt: /\salt="([^"]*)"/.exec(m[0])?.[1] ?? null, src: m[1] })),
];

const problems = [];
const warnings = [];
let checked = 0;

for (const file of await walk(CONTENT)) {
  const lines = bodyLines(await readFile(file, 'utf8'));

  for (const [i, line] of lines.entries()) {
    for (const { alt, src } of embedsIn(line)) {
      const at = `${file}:${i + 1}`;
      checked++;

      if (/^https?:\/\//i.test(src)) {
        let host = src;
        try { host = new URL(src).host; } catch {}
        problems.push(
          `${at}\n` +
          `      links a picture on ${host} instead of holding one.\n` +
          `      That address belongs to someone else and will stop answering — a picture\n` +
          `      pasted out of a chat is usually dead within the day, so the page publishes\n` +
          `      with a hole in it.\n` +
          `      Fix: in /admin, put the cursor where the picture belongs and use the image\n` +
          `      button in the note editor. That uploads the file into the site, so it keeps\n` +
          `      working, and it lands exactly where the cursor was.`
        );
        continue;
      }

      if (src.startsWith('data:') || src.startsWith('#')) continue;

      const target = src.startsWith('/')
        ? path.join(PUBLIC, decodeURI(src).replace(/^\//, ''))
        : path.join(path.dirname(file), decodeURI(src));

      if (!(await exists(target))) {
        problems.push(`${at}\n      points at ${src}, and there is no such file (looked for ${target}).`);
        continue;
      }

      if (alt !== null && (alt.trim() === '' || /^(image|img|picture|photo)$/i.test(alt.trim()))) {
        warnings.push(`${at}  alt text is "${alt}" — a screen reader reads that out and the listener learns nothing.`);
      }
    }
  }
}

if (warnings.length) {
  console.warn('! image warnings:');
  for (const w of warnings) console.warn('  ! ' + w);
}
if (problems.length) {
  console.error('✗ broken images in content:');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log(`✓ content images — ${checked} embedded picture(s), every one held by this site and present on disk`);
