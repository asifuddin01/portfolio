/**
 * Guards the one rule the reading course is built on.
 *
 * Lectiones tells the reader, on its own index page, that every paper appears
 * exactly once. That is not decoration — it is what makes finishing a part mean
 * something, and it is the only reason a reader can tell how much of the course
 * they have actually done. A repeat breaks a promise the page has made in
 * writing, and nothing else in the pipeline would notice: the schema is
 * satisfied, the build succeeds, the page renders.
 *
 * Also checks the things a numbered series gets wrong when it is edited from a
 * form: two parts claiming the same number, an empty course, a part that has
 * grown past the cap the series was designed around.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = 'src/content/lectiones';
const problems = [];
const warnings = [];

const files = (await readdir(DIR)).filter((f) => /\.mdx?$/.test(f));

/** Frontmatter only, and only the keys this guard reads. A YAML parser would
 *  be heavier than the job needs and this file is written by one form. */
const parse = (raw, file) => {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) { problems.push(`${file}: no frontmatter`); return null; }
  const body = fm[1];
  const scalar = (key) => {
    const m = body.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    if (!m) return null;
    return m[1].trim().replace(/^'(.*)'$/s, '$1').replace(/''/g, "'");
  };
  const readings = [];
  let current = null;
  let inList = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^readings:\s*$/.test(line)) { inList = true; continue; }
    if (inList && /^\S/.test(line)) break;             // next top-level key
    if (!inList) continue;
    const item = line.match(/^ {2}- (\w+):\s*(.*)$/);
    if (item) {
      current = {};
      readings.push(current);
      current[item[1]] = item[2].trim().replace(/^'(.*)'$/s, '$1').replace(/''/g, "'");
      continue;
    }
    const field = line.match(/^ {4}(\w+):\s*(.*)$/);
    if (field && current) {
      current[field[1]] = field[2].trim().replace(/^'(.*)'$/s, '$1').replace(/''/g, "'");
    }
  }
  return { part: Number(scalar('part')), title: scalar('title'), status: scalar('status'), readings };
};

const parts = [];
for (const f of files) {
  const p = parse(await readFile(path.join(DIR, f), 'utf8'), f);
  if (p) parts.push({ file: f, ...p });
}

/* Two parts with the same number: one of them loses its page silently. */
const byNumber = new Map();
for (const p of parts) {
  if (!Number.isInteger(p.part) || p.part < 1) {
    problems.push(`${p.file}: part number is "${p.part}" — it must be a whole number, 1 or more`);
    continue;
  }
  if (byNumber.has(p.part)) {
    problems.push(
      `${p.file} and ${byNumber.get(p.part).file} are both Part ${p.part}.\n` +
      `      Two parts cannot share a number — one of them would take the other's\n` +
      `      address. Give the newer one the next number up.`
    );
  } else byNumber.set(p.part, p);
}

/* The rule the index page states in writing. */
const seen = new Map();                                  // key → where it was first used
const key = (r) => (r.url || r.title || '').replace(/\/+$/, '').toLowerCase();
for (const p of parts.sort((a, b) => a.part - b.part)) {
  for (const r of p.readings) {
    const k = key(r);
    if (!k) continue;
    const first = seen.get(k);
    if (first && first.part !== p.part) {
      problems.push(
        `Part ${p.part} lists "${r.alias || r.title}", which is already in Part ${first.part}.\n` +
        `      Lectiones tells the reader on its index page that every paper appears\n` +
        `      exactly once — that is what makes finishing a part mean something.\n` +
        `      Fix: drop it here and refer back to Part ${first.part} in the introduction\n` +
        `      instead. Pointing back is the intended move; it is not a workaround.`
      );
    } else if (!first) seen.set(k, { part: p.part });

    for (const field of ['alias', 'title', 'authors', 'year', 'claim', 'why']) {
      if (!r[field]) {
        problems.push(`Part ${p.part}, "${r.alias || r.title || '(untitled)'}": ${field} is empty.`);
      }
    }
    // The schema's optionalUrl repairs a bare domain, so this is untidiness
    // rather than breakage — say so without failing a deploy over it.
    if (r.url && !/^https?:\/\//.test(r.url)) {
      warnings.push(`Part ${p.part}, "${r.alias}": link is "${r.url}"; it will be stored with https:// added.`);
    }
  }

  if (p.readings.length > 5) {
    problems.push(`Part ${p.part} has ${p.readings.length} papers. The series caps a part at five.`);
  } else if (p.readings.length < 3 && p.status === 'published') {
    warnings.push(`Part ${p.part} is published with ${p.readings.length} paper(s); the series says three to five.`);
  }
}

if (warnings.length) {
  console.warn('! lectiones warnings:');
  for (const w of warnings) console.warn('  ! ' + w);
}
if (problems.length) {
  console.error('✗ Lectiones problems:');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log(
  `✓ Lectiones — ${parts.length} parts, ${seen.size} papers, each one in exactly one part`
);
