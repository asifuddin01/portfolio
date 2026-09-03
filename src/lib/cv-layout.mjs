/**
 * Draws a CV object onto a PDF. Isomorphic on purpose: the build script calls
 * it in node to produce the published file, and the proof page calls it in the
 * browser to produce a tailored one. Same typography either way — that is the
 * whole reason it lives apart from the build script.
 *
 * Takes the structure from cv-data.mjs and knows nothing about content
 * collections, so a section the editor has retyped or dropped renders exactly
 * like one that came straight off disk.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4 = [595.28, 841.89];
const M = 52;
const RIGHT = A4[0] - M;
const WIDTH = A4[0] - M * 2;

const INK = rgb(0.098, 0.09, 0.075);
const SOFT = rgb(0.29, 0.267, 0.227);
const BRASS = rgb(0.431, 0.341, 0.122);

/**
 * One entry per section style. These carry the exact sizes the CV has always
 * used; adding a style is how a new kind of section gets its own typography,
 * rather than by special-casing an id in the drawing loop.
 */
const STYLES = {
  entry: {
    title: { font: 'serifBold', size: 9.4 },
    detail: { size: 8.8, lead: 11.4, colour: 'soft' },
    gap: 4,
  },
  work: {
    title: { font: 'serifBold', size: 9.4 },
    subtitle: { font: 'serifItalic', size: 8.8, lead: 11.4, colour: 'soft' },
    detail: { size: 8.4, lead: 11, colour: 'soft' },
    gap: 4,
  },
  paper: {
    title: { font: 'serif', size: 9 },
    detail: { font: 'sans', size: 7.8, lead: 10.4, colour: 'soft' },
    gap: 3,
  },
  project: {
    title: { font: 'serifBold', size: 9, block: true },
    detail: { size: 8.8, lead: 11.4, colour: 'soft' },
    gap: 4,
  },
  /* A bold run-in label with the text flowing straight on from it. */
  skill: { runIn: true, size: 8.8, lead: 11.2, gap: 3 },
  /* A bold label on its own line with the paragraph beneath — the shape the
     Additional block takes, where each note is a small titled block rather
     than a sentence that happens to start with a word in bold. */
  note: {
    title: { font: 'serifBold', size: 9, block: true },
    detail: { size: 8.8, lead: 11.4, colour: 'soft' },
    gap: 5,
  },
};

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** @returns {Promise<{bytes: Uint8Array, pages: number}>} */
export async function renderCv(cv) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${cv.author} — Curriculum vitae`);
  doc.setAuthor(cv.author);
  doc.setSubject('Curriculum vitae');
  doc.setProducer('portfolio build');
  doc.setCreationDate(new Date());

  const fonts = {
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    sans: await doc.embedFont(StandardFonts.Helvetica),
  };
  const colours = { ink: INK, soft: SOFT, brass: BRASS };

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

  function para(text, { font = fonts.serif, size = 9.2, colour = INK, lead = 12, indent = 0, gap = 0 } = {}) {
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
    page.drawText(String(label).toUpperCase(), {
      x: M, y: y - 7, size: 7.6, font: fonts.sans, color: BRASS, characterSpacing: 1.5,
    });
    y -= 12;
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: BRASS, opacity: 0.75 });
    y -= 11;
  }

  function twoCol(left, right, { size = 9.2, font = fonts.serif, colour = INK, lead = 12 } = {}) {
    const rightW = right ? font.widthOfTextAtSize(right, size) : 0;
    const lines = wrap(left, font, size, WIDTH - rightW - 14);
    room(lines.length * lead);
    lines.forEach((line, i) => {
      page.drawText(line, { x: M, y: y - size, size, font, color: colour });
      if (i === 0 && right) {
        page.drawText(right, { x: RIGHT - rightW, y: y - size, size, font: fonts.sans, color: BRASS });
      }
      y -= lead;
    });
  }

  /** Resolves a style fragment's font and colour names to embedded objects. */
  const spec = (frag = {}) => ({
    ...frag,
    font: fonts[frag.font] ?? fonts.serif,
    colour: colours[frag.colour] ?? INK,
  });

  /* ---------- masthead ---------- */
  page.drawText(clean(cv.author).toUpperCase(), {
    x: M, y: y - 20, size: 20, font: fonts.serifBold, color: INK, characterSpacing: 0.6,
  });
  y -= 30;

  const contact = (cv.contact ?? []).map(clean).filter(Boolean).join('  ·  ');
  if (contact) para(contact, { font: fonts.sans, size: 8, colour: SOFT, lead: 11 });
  y -= 2;
  page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: BRASS });
  y -= 14;

  if (clean(cv.summary)) para(clean(cv.summary), { size: 9.4, lead: 12.6, gap: 2 });

  /* ---------- sections ---------- */
  for (const section of cv.sections ?? []) {
    const items = (section.items ?? []).filter(
      (it) => clean(it.title) || clean(it.subtitle) || clean(it.detail)
    );
    if (!items.length) continue;

    const style = STYLES[section.style] ?? STYLES.entry;
    sectionRule(clean(section.heading));

    for (const item of items) {
      const title = clean(item.title);
      const right = clean(item.right);
      const subtitle = clean(item.subtitle);
      const detail = clean(item.detail);

      if (style.runIn) {
        /* Bold label, then the text continuing on the same line. */
        const label = title ? `${title}. ` : '';
        const labelW = fonts.serifBold.widthOfTextAtSize(label, style.size);
        const lines = wrap(detail, fonts.serif, style.size, WIDTH - labelW);
        room(lines.length * style.lead + 3);
        if (label) {
          page.drawText(label, { x: M, y: y - style.size, size: style.size, font: fonts.serifBold, color: INK });
        }
        lines.forEach((line, i) => {
          page.drawText(line, {
            x: i === 0 ? M + labelW : M,
            y: y - style.size,
            size: style.size,
            font: fonts.serif,
            color: SOFT,
          });
          y -= style.lead;
        });
        y -= style.gap ?? 0;
        continue;
      }

      if (title) {
        const t = spec(style.title);
        if (right && !style.title?.block) twoCol(title, right, t);
        else para(title, t);
      }
      if (subtitle && style.subtitle) para(subtitle, spec(style.subtitle));
      if (detail && style.detail) para(detail, spec(style.detail));
      y -= style.gap ?? 0;
    }
  }

  /* ---------- footer on every page ---------- */
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(
      `${clean(cv.author)} · page ${i + 1} of ${pages.length}` +
      (cv.siteHost ? ` · generated from ${cv.siteHost}` : ''),
      { x: M, y: M - 22, size: 7, font: fonts.sans, color: BRASS, opacity: 0.9 }
    );
  });

  return { bytes: await doc.save(), pages: pages.length };
}
