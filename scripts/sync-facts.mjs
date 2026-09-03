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
 * How many tests a Python repository has that pass.
 *
 * The suite is run rather than collected, and the difference is not cosmetic.
 * `--collect-only` counts every test that exists — for LocalScholar that is
 * 102, two of which are marked slow and deselected by default. Running it
 * reports 100 passed, 2 deselected, and 100 is the number a reader gets when
 * they run the command the README gives them. The site should claim the
 * figure somebody can reproduce, not the larger one.
 *
 * Counting with grep was never an option either way: `def test_` misses every
 * parametrised case, and parametrisation is where most of the count lives.
 *
 * A suite with failures returns null rather than a number, because a count of
 * passing tests is only worth stating when they all do.
 */
async function pytestCount(dir) {
  const python = path.join(dir, '.venv', 'bin', 'python');
  let stdout;
  try {
    ({ stdout } = await run(python, ['-m', 'pytest', '-q'], {
      cwd: dir,
      timeout: 15 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (e) {
    const out = `${e.stdout ?? ''}`;
    const failed = out.match(/(\d+)\s+failed/);
    notes.push(
      failed
        ? `${path.basename(dir)}: ${failed[1]} test(s) failing — not recording a count`
        : `${path.basename(dir)}: could not run the suite (${e.code ?? e.message})`,
    );
    return null;
  }
  const m = stdout.match(/(\d+)\s+passed/);
  if (!m) {
    notes.push(`${path.basename(dir)}: could not read a count out of pytest`);
    return null;
  }
  const deselected = stdout.match(/(\d+)\s+deselected/);
  if (deselected) {
    console.log(
      `  (${path.basename(dir)}: ${deselected[1]} deselected by default, not counted)`,
    );
  }
  return Number(m[1]);
}

const SPACE = 'https://asifuddin01-researchlens.hf.space/gradio_api/call/corpus_stats';

/** One call to the Space's stats endpoint. */
async function askSpace() {
  const started = await fetch(SPACE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [] }),
    signal: AbortSignal.timeout(90_000),
  });
  const { event_id } = await started.json();
  const stream = await fetch(`${SPACE}/${event_id}`, {
    signal: AbortSignal.timeout(180_000),
  });
  const text = await stream.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  const [stats] = JSON.parse(line.slice(6));
  return { papers: stats.papers, passages: stats.passages, added: stats.added ?? 0 };
}

/**
 * The corpus, from the running instance — asked until it stops changing.
 *
 * Asking once is not enough, and the reason is the design of the thing being
 * asked. The Space indexes the CMS library on a background thread and answers
 * immediately with whatever is indexed *now*, so that a reader's question is
 * never held up by a download. The first answer after the container wakes is
 * therefore the bundled corpus alone — which is exactly what happened: two
 * papers had been added, the Space had them minutes later, and this recorded
 * 101 because it asked once, at the wrong moment, and believed the answer.
 *
 * So it asks until two consecutive answers agree. That is the only signal
 * available from outside that the background work has finished.
 */
async function corpusFromSpace() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let previous = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    let now;
    try {
      now = await askSpace();
    } catch (e) {
      notes.push(`researchlens: the Space did not answer (${e.name ?? e.message})`);
      return previous;
    }
    if (previous && previous.papers === now.papers && previous.passages === now.passages) {
      if (attempt > 2) console.log(`  (the Space settled after ${attempt} reads)`);
      return now;
    }
    previous = now;
    /* Long enough for a download and a parse of a few papers, short enough
       that a command somebody typed still feels like it is doing something. */
    if (attempt < 8) await wait(15_000);
  }
  notes.push(
    'researchlens: the Space was still indexing after eight reads — ' +
      'run this again in a few minutes',
  );
  return previous;
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
