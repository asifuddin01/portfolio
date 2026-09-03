/**
 * Generates public/cv/Md-Asif-Uddin-CV.pdf from the same content the site
 * renders, so the CV cannot drift from the portfolio. Runs on every build.
 *
 * The shaping and the drawing both live in src/lib — this script is only the
 * disk reader. /vitae/cv builds the same object through getCollection and
 * hands it to the same renderer, which is what keeps the published PDF and a
 * tailored one typographically identical.
 *
 * Deliberately omits the phone number: this file is served publicly, and a
 * phone number on a public page is a different exposure from one on a CV you
 * hand to a person.
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { buildCv } from '../src/lib/cv-data.mjs';
import { renderCvDocx } from '../src/lib/cv-docx.mjs';
import { renderCv } from '../src/lib/cv-layout.mjs';

async function readCollection(dir) {
  const base = path.join('src/content', dir);
  let names;
  try {
    names = (await readdir(base)).filter((f) => f.endsWith('.mdx'));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const raw = await readFile(path.join(base, name), 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) continue;
    out.push({ id: name.replace(/\.mdx$/, ''), data: YAML.parse(m[1]) ?? {} });
  }
  return out;
}

const consts = await readFile('src/consts.ts', 'utf8');
const constOf = (key) => (consts.match(new RegExp(`${key} = '([^']*)'`)) ?? [])[1] ?? '';

const [site, works, papers, education, projects, skills, referees] = await Promise.all([
  readCollection('site'),
  readCollection('works'),
  readCollection('papers'),
  readCollection('education'),
  readCollection('projects'),
  readCollection('instrumentarium'),
  readCollection('referees'),
]);

const cv = buildCv({
  site, works, papers, education, projects, skills, referees,
  author: constOf('AUTHOR'),
  siteUrl: constOf('SITE'),
  fallback: {
    email: constOf('EMAIL'),
    github: constOf('GITHUB'),
    linkedin: constOf('LINKEDIN'),
    location: constOf('LOCATION'),
  },
});

if (/\+?\d[\d\s().-]{7,}/.test(JSON.stringify(cv))) {
  console.error('✗ refusing to write the CV: it contains something shaped like a phone number.');
  process.exit(1);
}

const { bytes, pages } = await renderCv(cv);
await mkdir('public/cv', { recursive: true });
await writeFile('public/cv/Md-Asif-Uddin-CV.pdf', bytes);

/* The same document as Word, from the same object. Some places will not read a
   PDF — an applicant-tracking system usually can, but not always well, and a
   person building their own template wants text they can move. Generated here
   rather than only in the editor so it exists for anyone who lands on the CV
   page without a login. */
const docx = renderCvDocx(cv);
await writeFile('public/cv/Md-Asif-Uddin-CV.docx', docx);

console.log(
  `✓ CV generated — ${pages} page(s), ${(bytes.length / 1024).toFixed(0)} KB PDF, ` +
  `${(docx.length / 1024).toFixed(0)} KB docx, ` +
  `${cv.sections.length} sections, no phone number`
);
