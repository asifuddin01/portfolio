import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error js-yaml ships no types; scripts/check-cms.mjs reads the recipes with it too.
import yaml from 'js-yaml';
import { Language, Parser } from 'web-tree-sitter';
import { instrumentC } from '../compiled/instrument-c.ts';
import { instrumentJava } from '../compiled/instrument-java.ts';
import type { ConditionMeta } from '../compiled/instrument.ts';
import { WireReader } from '../compiled/wire.ts';
import { TraceStore } from '../trace/store.ts';
import type { TraceStep } from '../trace/schema.ts';

/**
 * The C and Java tracers, run natively: instrumented exactly as the page
 * instruments them, then compiled by this machine's clang and javac rather
 * than the browser's. The trace comes out in the same JSON the page reads.
 *
 * Each program is also compiled and run as written, so a test can hold the
 * traced run to printing exactly what the untraced one printed.
 * scripts/test-officina-ai.mjs finds the compilers (OFFICINA_CC,
 * OFFICINA_JAVA_HOME).
 */

const HERE = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const CC = process.env.OFFICINA_CC || 'clang';
const JDK = process.env.OFFICINA_JAVA_HOME ? join(process.env.OFFICINA_JAVA_HOME, 'bin') + '/' : '';

await Parser.init();
const grammars = {
  c: await Language.load(HERE('../../../../node_modules/tree-sitter-wasms/out/tree-sitter-c.wasm')),
  java: await Language.load(HERE('../../../../node_modules/tree-sitter-wasms/out/tree-sitter-java.wasm')),
};

export function parsed<T>(language: 'c' | 'java', source: string, use: (root: import('web-tree-sitter').Node) => T): T {
  const parser = new Parser();
  parser.setLanguage(grammars[language]);
  const tree = parser.parse(source)!;
  try {
    return use(tree.rootNode);
  } finally {
    tree.delete();
    parser.delete();
  }
}

export interface NativeTrace {
  steps: TraceStep[];
  /** The line that ended the trace: done, exit, stop or error. */
  end: Record<string, unknown> | undefined;
  /** What the traced program printed, from its steps. */
  stdout: string;
  /** What the same program printed when compiled and run untraced, if it was. */
  original: string;
  conditions: ConditionMeta[];
}

function run(cmd: string, args: string[], cwd: string, input?: string) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 60_000 });
  if (r.error) throw r.error;
  return r;
}

/** The wire, read as the page reads it (compiled/wire.ts). */
function read(wire: string, conditions: ConditionMeta[], original: string): NativeTrace {
  const store = new TraceStore();
  new WireReader(store, conditions).push(`${wire}\n`);
  const end = wire.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).find((e) => !('event' in e));
  return { steps: store.steps, end, stdout: store.steps.map((s) => s.stdout ?? '').join(''), original, conditions };
}

export interface Options {
  input?: string;
  /** Steps, seconds, output characters: what the page passes. */
  limits?: [string, string, string];
  /** Run the program untraced too — not for one that never ends. */
  original?: boolean;
}

export function traceC(source: string, { input = '', limits = ['50000', '5', '262144'], original: compare = true }: Options = {}): NativeTrace {
  const dir = mkdtempSync(join(tmpdir(), 'officina-c-'));
  try {
    writeFileSync(join(dir, 'original.c'), source);
    let r = run(CC, ['-std=c23', '-O0', '-w', 'original.c', '-o', 'original', '-lm'], dir);
    if (r.status !== 0) throw new Error(`the program does not compile natively:\n${r.stderr}`);
    const original = compare ? run(join(dir, 'original'), [], dir, input).stdout : '';

    const { code, conditions } = parsed('c', source, (root) => instrumentC(root, source));
    writeFileSync(join(dir, 'program.c'), code);
    for (const f of ['trace.h', 'trace.c']) copyFileSync(HERE(`../compiled/${f}`), join(dir, f));
    for (const args of [
      ['-std=c23', '-O0', '-w', '-fsanitize=array-bounds,integer-divide-by-zero,null', '-include', 'trace.h', '-c', 'program.c'],
      ['-std=c23', '-O0', '-w', '-c', 'trace.c'],
      ['program.o', 'trace.o', '-o', 'traced', '-lm'],
    ]) {
      r = run(CC, args, dir);
      if (r.status !== 0) throw new Error(`the instrumented program does not compile:\n${r.stderr}\n${code}`);
    }
    return read(run(join(dir, 'traced'), [input, ...limits], dir).stderr, conditions, original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function traceJava(source: string, { input = '', limits = ['50000', '5', '262144'], original: compare = true }: Options = {}): NativeTrace {
  const dir = mkdtempSync(join(tmpdir(), 'officina-java-'));
  try {
    const { code, conditions, file, tables } = parsed('java', source, (root) => instrumentJava(root, source));
    const entry = tables.split('\u0002')[0];
    writeFileSync(join(dir, `${file}.java`), source);
    let r = run(`${JDK}javac`, ['--release', '8', '-nowarn', '-encoding', 'UTF-8', '-d', 'original', `${file}.java`], dir);
    if (r.status !== 0) throw new Error(`the program does not compile natively:\n${r.stderr}`);
    const original = compare ? run(`${JDK}java`, ['-cp', 'original', entry], dir, input).stdout : '';

    writeFileSync(join(dir, `${file}.java`), code);
    copyFileSync(HERE('../compiled/OfficinaTrace.java'), join(dir, 'OfficinaTrace.java'));
    r = run(`${JDK}javac`, ['--release', '8', '-nowarn', '-encoding', 'UTF-8', '-d', 'traced', `${file}.java`, 'OfficinaTrace.java'], dir);
    if (r.status !== 0) throw new Error(`the instrumented program does not compile:\n${r.stderr}\n${code}`);
    return read(run(`${JDK}java`, ['-cp', 'traced', 'OfficinaTrace', input, ...limits, tables], dir).stdout, conditions, original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The examples a recipe file lists — the page's and the notebook's. */
export function examples(language: 'c' | 'java'): { title: string; group: string; code: string; stdin?: string }[] {
  const front = readFileSync(HERE(`../../../content/recipes/${language}.mdx`), 'utf8').split(/^---$/m)[1];
  return (yaml.load(front) as { examples: { title: string; group: string; code: string; stdin?: string }[] }).examples;
}
