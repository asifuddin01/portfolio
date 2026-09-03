/**
 * Go and measure the numbers this site states about other repositories.
 *
 * Run: npm run facts
 *
 * Not part of the build, and deliberately. A build that reached out to a
 * sleeping Space and a sibling checkout would fail for reasons that have
 * nothing to do with the site, and would fail differently on a laptop than on
 * a runner. So the measuring is a thing somebody does, the result is committed,
 * and the build only ever reads a file.
 *
 * Each source is optional and each failure is reported rather than fatal:
 * running this on a machine without the ResearchLens checkout should update
 * what it can and say what it could not, not refuse to update anything.
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const FILE = 'src/data/facts.json';

/** Sibling checkouts, if this machine has them. */
const REPOS = {
  researchlens: path.resolve('..', 'researchlens'),
  localscholar: path.resolve('..', 'LocalScholar'),
};

const notes = [];

/**
 * How many tests a Python repository has.
 *
 * Collected rather than counted with grep: `def test_` misses every
 * parametrised case, and parametrisation is where most of the count lives.
 * `--collect-only -q` prints one line per collected test plus a summary.
 */
async function pytestCount(dir) {
  const python = path.join(dir, '.venv', 'bin', 'python');
  try {
    const { stdout } = await run(python, ['-m', 'pytest', '--collect-only', '-q'], {
      cwd: dir,
      timeout: 5 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const m = stdout.match(/(\d+)\s+tests?\s+collected/);
    if (m) return Number(m[1]);
    // Older pytest prints only the per-test lines and a bare count.
    const lines = stdout.split('\n').filter((l) => l.includes('::'));
    return lines.length || null;
  } catch (e) {
    notes.push(`${path.basename(dir)}: could not collect tests (${e.code ?? e.message})`);
    return null;
  }
}

/**
 * The corpus, from the running instance rather than from the bundle on disk.
 *
 * The live figure is the one the site's own header shows a reader, and since
 * papers can now be added through the CMS it moves without either repository
 * changing. Asking the thing itself is the only way to be right about it.
 */
async function corpusFromSpace() {
  const url =
    'https://asifuddin01-researchlens.hf.space/gradio_api/call/corpus_stats';
  try {
    const started = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [] }),
      signal: AbortSignal.timeout(60_000),
    });
    const { event_id } = await started.json();
    const stream = await fetch(`${url}/${event_id}`, {
      signal: AbortSignal.timeout(120_000),
    });
    const text = await stream.text();
    const line = text.split('\n').find((l) => l.startsWith('data: '));
    const [stats] = JSON.parse(line.slice(6));
    return { papers: stats.papers, passages: stats.passages };
  } catch (e) {
    notes.push(`researchlens: the Space did not answer (${e.name ?? e.message})`);
    return null;
  }
}

const before = JSON.parse(await readFile(FILE, 'utf8'));
const after = structuredClone(before);

const corpus = await corpusFromSpace();
if (corpus) {
  after.researchlens.papers = corpus.papers;
  after.researchlens.passages = corpus.passages;
}

for (const [name, dir] of Object.entries(REPOS)) {
  const tests = await pytestCount(dir);
  if (tests) after[name].tests = tests;
}

after.checkedAt = new Date().toISOString().slice(0, 10);

/* Report every field, changed or not: "nothing moved" and "nothing was
   measured" look identical in a diff, and only one of them is fine. */
const rows = [];
for (const project of ['researchlens', 'localscholar']) {
  for (const [key, value] of Object.entries(after[project])) {
    const was = before[project][key];
    rows.push(
      `  ${project}.${key.padEnd(9)} ${String(value).padStart(6)}` +
        (was === value ? '' : `   (was ${was})`),
    );
  }
}

await writeFile(FILE, `${JSON.stringify(after, null, 2)}\n`);
console.log(rows.join('\n'));
for (const n of notes) console.log(`  ! ${n}`);
console.log(
  notes.length
    ? `✓ facts updated where they could be measured — ${notes.length} source(s) unavailable`
    : '✓ facts updated from every source',
);
