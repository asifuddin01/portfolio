/**
 * The Officina AI tests: the Python tracer on native CPython, then the trace
 * store, the value formatter, and the same tracer inside Pyodide, compared step
 * for step with the native run.
 *
 * The tracer's native tests need Python 3.14, because that is the Python
 * Pyodide 314 embeds and line events differ between versions. The site's own
 * `python3` is 3.12 in CI — the Elementa snippets were recorded under it — so
 * this looks for 3.14 separately: OFFICINA_PYTHON if set (the deploy workflow
 * sets it), else `python3.14`, else `python3` if that happens to be 3.14.
 */
import { execFileSync, spawnSync } from 'node:child_process';

const DIR = 'src/lib/officina-ai/tests';

function version(bin) {
  try {
    return execFileSync(bin, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const candidates = [process.env.OFFICINA_PYTHON, 'python3.14', 'python3'].filter(Boolean);
const python = candidates.find((bin) => version(bin) === '3.14');
if (!python) {
  console.error(
    '✗ Officina AI: the tracer tests need Python 3.14 — the version Pyodide 314 runs — and none was found ' +
      `(tried ${candidates.join(', ')}). Install it, or point OFFICINA_PYTHON at one.`
  );
  process.exit(1);
}

// No __pycache__ beside the tracer: it is source in src/, not a package.
const env = { ...process.env, OFFICINA_PYTHON: python, PYTHONDONTWRITEBYTECODE: '1' };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(python, ['-m', 'unittest', 'discover', '-s', DIR, '-p', 'test_*.py']);
run(process.execPath, ['--test', `${DIR}/*.test.ts`]);
console.log('✓ Officina AI: tracer, store, formatter and Pyodide parity');
