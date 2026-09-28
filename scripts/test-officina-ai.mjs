/**
 * The Officina AI tests: the Python tracer on native CPython, then the trace
 * store, the value formatter, the same tracer inside Pyodide, compared step
 * for step with the native run, and the C and Java tracers, compiled by this
 * machine's clang and javac.
 *
 * The tracer's native tests need Python 3.14, because that is the Python
 * Pyodide 314 embeds and line events differ between versions. The site's own
 * `python3` is 3.12 in CI — the Elementa snippets were recorded under it — so
 * this looks for 3.14 separately: OFFICINA_PYTHON if set (the deploy workflow
 * sets it), else `python3.14`, else `python3` if that happens to be 3.14.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

/*
 * The C and Java tracers are instrumented as the page instruments them and
 * then compiled natively: clang (OFFICINA_CC, else `clang`) and a JDK that can
 * compile for Java 8 (OFFICINA_JAVA_HOME, else JAVA_HOME, else Homebrew's
 * openjdk, else `javac` on the PATH). The deploy workflow installs both.
 */
const works = (bin, args) => spawnSync(bin, args, { encoding: 'utf8' }).status === 0;
const cc = process.env.OFFICINA_CC || 'clang';
if (!works(cc, ['--version'])) {
  console.error(`✗ Officina AI: the C tracer tests need clang, and ${cc} did not run. Install it, or point OFFICINA_CC at one.`);
  process.exit(1);
}
const jdk = [process.env.OFFICINA_JAVA_HOME, process.env.JAVA_HOME, '/opt/homebrew/opt/openjdk@17', '/opt/homebrew/opt/openjdk', '/usr/local/opt/openjdk@17']
  .filter(Boolean)
  .find((home) => existsSync(join(home, 'bin', 'javac')) && works(join(home, 'bin', 'javac'), ['--release', '8', '-version']));
if (!jdk && !works('javac', ['--release', '8', '-version'])) {
  console.error('✗ Officina AI: the Java tracer tests need a JDK 9 or later (it compiles for Java 8 with --release 8), ' +
    'and none was found. Install one, or point OFFICINA_JAVA_HOME at it.');
  process.exit(1);
}

// No __pycache__ beside the tracer: it is source in src/, not a package.
const env = {
  ...process.env, OFFICINA_PYTHON: python, PYTHONDONTWRITEBYTECODE: '1', OFFICINA_CC: cc,
  ...(jdk ? { OFFICINA_JAVA_HOME: jdk } : {}),
};
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(python, ['-m', 'unittest', 'discover', '-s', DIR, '-p', 'test_*.py']);
run(process.execPath, ['--test', `${DIR}/*.test.ts`]);
console.log('✓ Officina AI: the Python, C and Java tracers, store, formatter and Pyodide parity');
