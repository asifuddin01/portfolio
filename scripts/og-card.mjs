/**
 * The social card for one page.
 *
 * Every page had the same card — the author's name and a quotation — so a link
 * to a proposition about saturating activations and a link to the CV arrived
 * in a chat window looking identical. The card is the only part of the site
 * most people see before deciding whether to open it, and it was saying
 * nothing about the page it belonged to.
 *
 * Rendered from hand-written SVG rather than a layout engine, which is how
 * `make-og.mjs` already drew the single card, and rasterised by resvg with the
 * two typefaces loaded from files in this repository. That last part is what
 * makes it work in CI: the old script relied on macOS shipping Didot, so the
 * same code on an Ubuntu runner would have quietly rendered the site's display
 * face as whatever the runner had.
 *
 * The cost of hand-written SVG is that nothing lays the text out, so the
 * wrapping below does it — from real measurements, since resvg will report the
 * width of a parsed string without rasterising it.
 */
import { Resvg } from '@resvg/resvg-js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(HERE, '..', 'src', 'assets', 'og');

const FONTS = [
  path.join(FONT_DIR, 'BodoniModa.ttf'),
  path.join(FONT_DIR, 'IBMPlexMono-Regular.ttf'),
];

/* The site's own tokens, in their vellum values. A social card has no theme:
   it is an image, and the reader's preference never reaches it. */
const PAPER = '#E7E1CE';
const INK = '#191713';
const INK_SOFT = '#4A443A';
const BRASS = '#94762F';
/** The lesion rule — the ornament that separates sections on the site. */
const LESION = ['#8C2F26', '#4E1E2C', '#C9A227', '#93A98F', '#2F566D'];

const WIDTH = 1200;
const HEIGHT = 630;
const MARGIN = 96;
const TEXT_WIDTH = WIDTH - MARGIN * 2;

/* The band the title lives in: below the section label's baseline, above the
   ornament. Both ends are fixed so every card's furniture lands in the same
   place and a row of them reads as a set. */
const BAND_TOP = 208;
const BAND_BOTTOM = 452;
const BAND = BAND_BOTTOM - BAND_TOP;
const LEADING = 1.18;
const MAX_SIZE = 64;
const MIN_SIZE = 30;

function fontConfig() {
  return { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Bodoni Moda' };
}

/**
 * How wide a string is, in points, at a given font size.
 *
 * Measured rather than estimated. The first version of this guessed from a
 * table of per-character widths, and the guess was wrong in the direction that
 * shows: "The loss and the output nonlinearity" was estimated to fit 1008
 * points and actually needs 1065, so the first line of that card ran off the
 * right edge. resvg can report the bounding box of a parsed tree without
 * rasterising it, which costs a third of a millisecond and is exact.
 *
 * Everything is measured once at `REF_SIZE` and scaled. Glyph advances scale
 * linearly with font size, so trying eight sizes costs no more measurements
 * than trying one — which matters, because the fit below tries several.
 */
const REF_SIZE = 100;
const widths = new Map();

function measureAt(text) {
  const cached = widths.get(text);
  if (cached !== undefined) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="400">`
    + `<text x="0" y="300" font-family="Bodoni Moda" font-size="${REF_SIZE}">${esc(text)}</text></svg>`;
  const box = new Resvg(svg, { font: fontConfig() }).getBBox();
  const w = box ? box.width : text.length * REF_SIZE * 0.5;
  widths.set(text, w);
  return w;
}

/** The advance of a single space, derived once. */
let spaceRef = null;
function spaceAt() {
  if (spaceRef === null) spaceRef = measureAt('n n') - 2 * measureAt('n');
  return spaceRef;
}

function textWidth(words, size) {
  if (!words.length) return 0;
  let ref = 0;
  for (const w of words) ref += measureAt(w);
  ref += spaceAt() * (words.length - 1);
  return (ref * size) / REF_SIZE;
}

/** Greedy wrap to a pixel width, breaking on spaces. */
function wrap(text, size, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = [];
  for (const w of words) {
    if (line.length && textWidth([...line, w], size) > maxWidth) {
      lines.push(line);
      line = [w];
    } else {
      line.push(w);
    }
  }
  if (line.length) lines.push(line);
  return lines.map((l) => l.join(' '));
}

/**
 * Fit the title into the band between the section label and the ornament.
 *
 * Titles run from two words to a whole sentence — a proposition states its
 * entire claim in its title — so one size cannot serve both, and the height is
 * as much a constraint as the width. An earlier version capped the line count
 * and ignored the height, which let a four-line title at full size run through
 * the rule and out the bottom of the card.
 *
 * Shrinking comes before truncating, because the sentence being complete is
 * the reason for putting it there at all.
 */
function fitTitle(title) {
  for (let size = MAX_SIZE; size >= MIN_SIZE; size -= 2) {
    const lines = wrap(title, size, TEXT_WIDTH);
    if (lines.length * size * LEADING <= BAND) return { size, lines };
  }
  const maxLines = Math.max(1, Math.floor(BAND / (MIN_SIZE * LEADING)));
  const lines = wrap(title, MIN_SIZE, TEXT_WIDTH).slice(0, maxLines);
  const last = lines.length - 1;
  lines[last] = `${lines[last].replace(/[\s.,;:—-]+$/, '')}…`;
  return { size: MIN_SIZE, lines };
}

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** The SVG for one card. Exported so a test can read it without rasterising. */
export function cardSvg({ title, section, footer = 'MD. ASIF UDDIN · ASIFUDDIN.COM' }) {
  const { size, lines } = fitTitle(title);
  const leading = size * LEADING;

  /* The block is centred in the band, so a one-line title and a four-line one
     both sit optically in the middle rather than one hanging from the top. */
  const blockHeight = (lines.length - 1) * leading;
  const firstBaseline = (BAND_TOP + BAND_BOTTOM) / 2 - blockHeight / 2 + size * 0.34;

  const titleTspans = lines
    .map(
      (line, i) =>
        `<tspan x="${MARGIN}" y="${(firstBaseline + i * leading).toFixed(1)}">${esc(line)}</tspan>`,
    )
    .join('');

  /* The ornament, drawn once at a fixed place: five stops of the lesion rule
     between two hairlines, exactly as the page separates its sections. */
  const ruleY = 486;
  const dotsStart = MARGIN + 4;
  const dots = LESION.map(
    (c, i) => `<circle cx="${dotsStart + i * 34}" cy="${ruleY}" r="7" fill="${c}"/>`,
  ).join('');
  const ruleFrom = dotsStart + 4 * 34 + 38;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
  <rect x="40" y="40" width="${WIDTH - 80}" height="${HEIGHT - 80}" fill="none" stroke="${BRASS}" stroke-width="1"/>

  <text x="${MARGIN}" y="176" font-family="IBM Plex Mono" font-size="24" fill="${BRASS}" letter-spacing="4">${esc(
    section.toUpperCase(),
  )}</text>

  <text font-family="Bodoni Moda" font-size="${size}" fill="${INK}">${titleTspans}</text>

  ${dots}
  <line x1="${ruleFrom}" y1="${ruleY}" x2="${WIDTH - MARGIN}" y2="${ruleY}" stroke="${BRASS}" stroke-width="1"/>

  <text x="${MARGIN}" y="552" font-family="IBM Plex Mono" font-size="20" fill="${INK_SOFT}" letter-spacing="3.4">${esc(
    footer,
  )}</text>
</svg>`;
}

let fontFiles = null;

/** Render one card to PNG. Fonts are read once and reused across the run. */
export async function renderCard(opts) {
  if (!fontFiles) {
    /* Read rather than pointed at, so a missing file fails here with the path
       in the message instead of silently rendering in a fallback face. */
    await Promise.all(FONTS.map((f) => readFile(f)));
    fontFiles = FONTS;
  }
  const svg = cardSvg(opts);
  return new Resvg(svg, {
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Bodoni Moda' },
    fitTo: { mode: 'width', value: WIDTH },
  })
    .render()
    .asPng();
}
