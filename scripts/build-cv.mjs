/**
 * Generates public/cv/Md-Asif-Uddin-CV.pdf from the same content the site
 * renders, so the CV cannot drift from the portfolio. Runs on every build.
 *
 * Deliberately omits the phone number: this file is served publicly, and a
 * phone number on a public page is a different exposure from one on a CV you
 * hand to a person.
 *
 * Research entries carry the title and what the work does, and nothing more.
 * No metrics, no abstracts — results belong on the plate, not the CV.
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import YAML from 'yaml';

/* ---------- read the collections straight off disk ---------- */
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

const AUTHOR = constOf('AUTHOR');
const EMAIL = constOf('EMAIL');
const GITHUB = constOf('GITHUB');
const LINKEDIN = constOf('LINKEDIN');
const LOCATION = constOf('LOCATION');
const SITE = constOf('SITE');

const [siteEntries, works, papers, education, projects, skills] = await Promise.all([
  readCollection('site'),
  readCollection('works'),
  readCollection('papers'),
  readCollection('education'),
  readCollection('projects'),
  readCollection('instrumentarium'),
]);

const cvMeta = siteEntries.find((e) => e.id === 'cv')?.data ?? {};
const byOrder = (a, b) => (a.data.order ?? 0) - (b.data.order ?? 0);

const STATE = {
  published: 'Published',
  preprint: 'Preprint',
  'under-review': 'Under review',
  'in-preparation': 'In preparation',
};
const PLATE_STATUS = {
  deposited: 'Deposited',
  'in-preparation': 'In preparation',
  'proposal-accepted': 'Proposal accepted',
};

/* ---------- page setup ---------- */
const doc = await PDFDocument.create();
doc.setTitle(`${AUTHOR} — Curriculum vitae`);
doc.setAuthor(AUTHOR);
doc.setSubject('Curriculum vitae');
doc.setProducer('portfolio build');
doc.setCreationDate(new Date());

const serif = await doc.embedFont(StandardFonts.TimesRoman);
const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
const serifItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);
const sans = await doc.embedFont(StandardFonts.Helvetica);

const A4 = [595.28, 841.89];
const M = 52;
const RIGHT = A4[0] - M;
const WIDTH = A4[0] - M * 2;

const INK = rgb(0.098, 0.09, 0.075);
const SOFT = rgb(0.29, 0.267, 0.227);
const BRASS = rgb(0.431, 0.341, 0.122);

let page = doc.addPage(A4);
let y = A4[1] - M;

function room(need) {
  if (y - need < M) {
    page = doc.addPage(A4);
    y = A4[1] - M;
  }
}

function wrap(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function para(text, { font = serif, size = 9.2, colour = INK, lead = 12, indent = 0, gap = 0 } = {}) {
  const lines = wrap(text, font, size, WIDTH - indent);
  room(lines.length * lead);
  for (const line of lines) {
    page.drawText(line, { x: M + indent, y: y - size, size, font, color: colour });
    y -= lead;
  }
  y -= gap;
}

function sectionRule(label) {
  room(34);
  y -= 8;
  page.drawText(label.toUpperCase(), {
    x: M, y: y - 7, size: 7.6, font: sans, color: BRASS,
    characterSpacing: 1.5,
  });
  y -= 12;
  page.drawLine({
    start: { x: M, y }, end: { x: RIGHT, y },
    thickness: 0.5, color: BRASS, opacity: 0.75,
  });
  y -= 11;
}

function twoCol(left, right, { size = 9.2, font = serif, colour = INK, lead = 12 } = {}) {
  const rightW = right ? font.widthOfTextAtSize(right, size) : 0;
  const lines = wrap(left, font, size, WIDTH - rightW - 14);
  room(lines.length * lead);
  lines.forEach((line, i) => {
    page.drawText(line, { x: M, y: y - size, size, font, color: colour });
    if (i === 0 && right) {
      page.drawText(right, { x: RIGHT - rightW, y: y - size, size, font: sans, color: BRASS });
    }
    y -= lead;
  });
}

/* ---------- masthead ---------- */
page.drawText(AUTHOR.toUpperCase(), {
  x: M, y: y - 20, size: 20, font: serifBold, color: INK, characterSpacing: 0.6,
});
y -= 30;

const contact = [LOCATION, EMAIL, LINKEDIN.replace(/^https?:\/\//, ''), GITHUB.replace(/^https?:\/\//, ''), SITE.replace(/^https?:\/\//, '')]
  .filter(Boolean)
  .join('  ·  ');
para(contact, { font: sans, size: 8, colour: SOFT, lead: 11 });
y -= 2;
page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: BRASS });
y -= 14;

/* ---------- summary ---------- */
if (cvMeta.summary) para(cvMeta.summary, { size: 9.4, lead: 12.6, gap: 2 });

/* ---------- education ---------- */
if (education.length) {
  sectionRule('Education');
  for (const e of [...education].sort(byOrder)) {
    twoCol(`${e.data.degree} — ${e.data.institution}, ${e.data.location}`, e.data.period, { font: serifBold, size: 9.4 });
    if (e.data.detail) para(e.data.detail, { size: 8.8, colour: SOFT, lead: 11.4 });
    y -= 4;
  }
}

/* ---------- research: name and what it does, nothing more ---------- */
if (works.length) {
  sectionRule('Research');
  for (const w of [...works].sort((a, b) => a.data.plate - b.data.plate)) {
    twoCol(w.data.title, w.data.year, { font: serifBold, size: 9.4 });
    para(w.data.subtitle, { font: serifItalic, size: 8.8, colour: SOFT, lead: 11.4 });
    const who = [];
    if (w.data.supervisors?.length) who.push(`Supervisor${w.data.supervisors.length > 1 ? 's' : ''}: ${w.data.supervisors.join(', ')}`);
    if (w.data.status) who.push(PLATE_STATUS[w.data.status] ?? w.data.status);
    if (who.length) para(who.join('. ') + '.', { size: 8.4, colour: SOFT, lead: 11 });
    y -= 4;
  }
}

/* ---------- papers ---------- */
if (papers.length) {
  sectionRule('Papers and manuscripts');
  const RANK = { published: 0, preprint: 1, 'under-review': 2, 'in-preparation': 3 };
  const sorted = [...papers].sort(
    (a, b) => (RANK[a.data.state] ?? 9) - (RANK[b.data.state] ?? 9) || String(b.data.year).localeCompare(String(a.data.year))
  );
  for (const p of sorted) {
    twoCol(p.data.title, `${STATE[p.data.state] ?? ''} ${p.data.year}`.trim(), { size: 9 });
    const tail = [p.data.venue, p.data.url].filter(Boolean).join('  ·  ');
    if (tail) para(tail, { font: sans, size: 7.8, colour: SOFT, lead: 10.4 });
    y -= 3;
  }
}

/* ---------- skills ---------- */
if (skills.length) {
  sectionRule('Technical');
  for (const s of [...skills].sort(byOrder)) {
    const label = `${s.data.title}. `;
    const labelW = serifBold.widthOfTextAtSize(label, 8.8);
    const lines = wrap(s.data.items, serif, 8.8, WIDTH - labelW);
    room(lines.length * 11.2 + 3);
    page.drawText(label, { x: M, y: y - 8.8, size: 8.8, font: serifBold, color: INK });
    lines.forEach((line, i) => {
      page.drawText(line, {
        x: i === 0 ? M + labelW : M,
        y: y - 8.8,
        size: 8.8,
        font: serif,
        color: SOFT,
      });
      y -= 11.2;
    });
    y -= 3;
  }
}

/* ---------- projects ---------- */
if (projects.length) {
  sectionRule('Engineering');
  for (const p of [...projects].sort(byOrder)) {
    para(p.data.title, { font: serifBold, size: 9 });
    para(p.data.cvSummary ?? p.data.summary, { size: 8.8, colour: SOFT, lead: 11.4, gap: 4 });
  }
}

/* ---------- additional ---------- */
if (cvMeta.languages) {
  sectionRule('Additional');
  para(`Languages. ${cvMeta.languages}`, { size: 8.8, colour: SOFT, lead: 11.4 });
}

/* ---------- footer on every page ---------- */
const pages = doc.getPages();
pages.forEach((pg, i) => {
  pg.drawText(`${AUTHOR} · page ${i + 1} of ${pages.length} · generated from ${SITE.replace(/^https?:\/\//, '')}`, {
    x: M, y: M - 22, size: 7, font: sans, color: BRASS, opacity: 0.9,
  });
});

await mkdir('public/cv', { recursive: true });
const bytes = await doc.save();
await writeFile('public/cv/Md-Asif-Uddin-CV.pdf', bytes);
console.log(`✓ CV generated — ${pages.length} page(s), ${(bytes.length / 1024).toFixed(0)} KB, no phone number`);
