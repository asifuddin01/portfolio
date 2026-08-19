/** Deterministic WCAG check over the token file itself — no browser needed. */
import { readFile } from 'node:fs/promises';

const css = await readFile('src/styles/tokens.css', 'utf8');
function block(re) {
  const m = css.match(re);
  const out = {};
  for (const [, k, v] of (m?.[1] ?? '').matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6});/g)) out[k] = v;
  return out;
}
const base = block(/:root\s*\{([\s\S]*?)\n\}/);
const dark = { ...base, ...block(/:root\[data-theme='nocturne'\]\s*\{([\s\S]*?)\n\}/) };

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (h) => { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); const hi = Math.max(x, y), lo = Math.min(x, y); return (hi + 0.05) / (lo + 0.05); };

/* [foreground, background, required] — grounds are both page and raised card. */
const PAIRS = [
  ['ink', 'paper', 7], ['ink', 'paper-raised', 7],
  ['ink-soft', 'paper', 4.5], ['ink-soft', 'paper-raised', 4.5],
  ['fundus', 'paper', 4.5], ['fundus', 'paper-raised', 4.5],
  ['brass-text', 'paper', 4.5], ['brass-text', 'paper-raised', 4.5],
  ['oxblood-text', 'paper', 4.5], ['oxblood-text', 'paper-raised', 4.5],
  ['verdigris', 'paper', 4.5], ['verdigris', 'paper-raised', 4.5],
];

let fails = 0;
for (const [name, tokens] of [['VELLUM', base], ['NOCTURNE', dark]]) {
  console.log(`\n${name}`);
  for (const [fg, bg, need] of PAIRS) {
    const r = ratio(tokens[fg], tokens[bg]);
    const ok = r >= need;
    if (!ok) fails++;
    console.log(
      `  ${ok ? '✓' : '✗'} ${fg.padEnd(13)} on ${bg.padEnd(13)} ${r.toFixed(2).padStart(6)} : 1   (need ${need})`
    );
  }
}
console.log(fails === 0 ? '\n✓ all token pairs pass' : `\n✗ ${fails} failing pair(s)`);
process.exit(fails ? 1 : 0);
