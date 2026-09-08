/**
 * Every writeup in Numina must name a tradition that exists.
 *
 * `pantheon` is a file name rather than an enum, so that adding a twelfth
 * tradition is a matter of adding a file from /admin rather than editing a Zod
 * schema. The cost of that freedom is that a typo — "norce", "greeek" — is not
 * a type error. It files the piece under a tradition nobody has, which means it
 * appears on no page at all and the only symptom is an index count that is one
 * lower than expected.
 *
 * This turns that into a build failure that names the file and lists what it
 * could have meant.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const PANTHEONS = 'src/content/pantheons';
const NUMINA = 'src/content/numina';

const mdx = async (dir) => {
  try {
    return (await readdir(dir, { recursive: true })).filter((f) => /\.mdx?$/.test(f));
  } catch {
    return [];
  }
};

const frontmatter = async (file) => {
  const text = await readFile(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
};

/** Book slug → the chapter ids it declares, in order. */
const books = new Map();
for (const rel of await mdx(PANTHEONS)) {
  const fm = await frontmatter(path.join(PANTHEONS, rel));
  const ids = [...fm.matchAll(/^\s*-\s*id:\s*["']?([\w-]+)["']?\s*$/gm)].map((m) => m[1]);
  books.set(rel.replace(/\.mdx?$/, ''), ids);
}
const known = new Set(books.keys());
if (known.size === 0) {
  console.error(`✗ ${PANTHEONS} has no traditions. Numina would render an empty index.`);
  process.exit(1);
}

const problems = [];
const counts = new Map([...known].map((k) => [k, 0]));

for (const rel of await mdx(NUMINA)) {
  const fm = await frontmatter(path.join(NUMINA, rel));
  const named = fm.match(/^pantheon:\s*["']?([\w-]+)["']?\s*$/m)?.[1];

  if (!named) {
    problems.push(`${rel}: no "pantheon:" line — it would belong to no tradition`);
    continue;
  }
  if (!known.has(named)) {
    const near = [...known].filter((k) => k.startsWith(named.slice(0, 3)));
    problems.push(
      `${rel}: book "${named}" matches no file in ${PANTHEONS}` +
      (near.length ? ` — did you mean ${near.join(' or ')}?` : '')
    );
    continue;
  }

  // A chapter the book does not declare files the topic nowhere: the book page
  // renders its chapters, and a topic outside all of them is simply not drawn.
  const chapter = fm.match(/^chapter:\s*["']?([\w-]+)["']?\s*$/m)?.[1];
  const chapters = books.get(named);
  if (!chapter) {
    problems.push(`${rel}: no "chapter:" line — it would appear in no chapter of ${named}`);
    continue;
  }
  if (!chapters.includes(chapter)) {
    problems.push(
      `${rel}: chapter "${chapter}" is not one of ${named}'s — it has ` +
      (chapters.length ? chapters.map((c) => `"${c}"`).join(', ') : 'no chapters yet')
    );
    continue;
  }
  counts.set(named, counts.get(named) + 1);
}

if (problems.length) {
  console.error('✗ Numina:');
  for (const p of problems) console.error(`   ${p}`);
  process.exit(1);
}

const written = [...counts.values()].filter((n) => n > 0).length;
const total = [...counts.values()].reduce((a, b) => a + b, 0);
const chapterCount = [...books.values()].reduce((n, c) => n + c.length, 0);
console.log(
  `✓ Numina — ${known.size} books, ${chapterCount} chapters, ${total} topic(s), ` +
  `each filed under a chapter that exists` +
  (written < known.size ? ` (${known.size - written} book(s) still empty)` : '')
);
