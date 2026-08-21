/**
 * Renumbers the tabulae so the position you type matches the position you see.
 *
 * Hiding a plate leaves a hole in the numbering: switch four of them off and
 * the plate showing fourth might be stored as 6. Typing "4" then looks like
 * it did nothing, because 4 is behind a plate that is not on the page.
 *
 * Ordering never depended on the numbers being contiguous — a plate set to an
 * occupied position already pushes the others down. This only keeps the
 * numbers legible.
 *
 *   npm run tidy:plates          rewrite the files
 *   npm run tidy:plates -- --dry show what would change
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = 'src/content/art';
const dry = process.argv.includes('--dry');

const entries = [];
for (const name of (await readdir(DIR)).filter((f) => f.endsWith('.mdx'))) {
  const file = path.join(DIR, name);
  const raw = await readFile(file, 'utf8');
  entries.push({
    file,
    slug: name.replace(/\.mdx$/, ''),
    raw,
    pos: Number(raw.match(/^homePosition: ([\d.]+)/m)?.[1] ?? 999),
    order: Number(raw.match(/^order: (\d+)/m)?.[1] ?? 999),
    shown: /^onHome: true/m.test(raw),
  });
}

const bySlot = (a, b) => a.pos - b.pos || a.order - b.order;
const shown = entries.filter((e) => e.shown).sort(bySlot);
const hidden = entries.filter((e) => !e.shown).sort(bySlot);

// Visible plates take 1..n in the order they appear; hidden ones follow, so
// switching one on puts it at the end rather than in the middle.
const sequence = [...shown, ...hidden];
let changed = 0;

for (const [i, e] of sequence.entries()) {
  const next = i + 1;
  if (e.pos === next) continue;
  changed++;
  const where = e.shown ? `page position ${shown.indexOf(e) + 1}` : 'hidden';
  console.log(`  ${e.slug.padEnd(30)} ${String(e.pos).padStart(3)} → ${String(next).padStart(3)}   (${where})`);
  if (!dry) {
    await writeFile(e.file, e.raw.replace(/^homePosition: [\d.]+/m, `homePosition: ${next}`));
  }
}

if (changed === 0) console.log('  already tidy — every number matches its position');
else console.log(`\n  ${changed} renumbered${dry ? ' (dry run, nothing written)' : ''}`);
