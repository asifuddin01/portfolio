import { Parser, Language, type Node } from 'web-tree-sitter';
import parserWasm from 'web-tree-sitter/tree-sitter.wasm?url';
import cGrammar from 'tree-sitter-wasms/out/tree-sitter-c.wasm?url';
import javaGrammar from 'tree-sitter-wasms/out/tree-sitter-java.wasm?url';
import traceHeader from './trace.h?raw';
import traceRuntime from './trace.c?raw';
import javaRuntime from './OfficinaTrace.java?raw';
import { instrumentC } from './instrument-c.ts';
import { instrumentJava } from './instrument-java.ts';
import { UnsupportedTrace, type ConditionMeta } from './instrument.ts';
import { TraceStore } from '../trace/store.ts';
import { LRU, traceKey } from '../trace/cache.ts';
import { DEFAULT_LIMITS, type RuntimeState, type TraceRequest, type TraceRun } from '../python/runtime.ts';
import type { TraceLimits, TraceResult, TraceStep } from '../trace/schema.ts';
import { WireReader, resultOf, type CompiledLanguage } from './wire.ts';
export type { CompiledLanguage };

/**
 * C and Java tracing, from the page's side.
 *
 * Both are compiled here, in the browser, with the toolchains /officina
 * already runs: clang and wasm-ld built to WebAssembly (emception) for C,
 * and the Eclipse compiler on CheerpJ's JVM for Java. Before compiling, the
 * program is instrumented (instrument-c.ts, instrument-java.ts) so that as
 * it runs it writes its own trace — a line of JSON per step — which this file
 * reads into a TraceStore, exactly where Python's steps go. The trace is what
 * the compiled program did; nothing here guesses.
 *
 * A run that is stopped is abandoned rather than killed: the program ends by
 * its own step and time limits within seconds, and killing clang's worker
 * would throw away a toolchain that takes far longer than that to load again.
 * Only a C program that outlives its limits is killed from outside. The JVM
 * runs on the page's thread and cannot be killed at all, so it is never asked
 * to run two programs at once.
 */


/** Time past a program's own limit before a C run is killed from outside. */
const HARD_GRACE_MS = 3000;
/** Time for wasi-run to load and start a program before it is given up on. */
const START_MS = 120_000;

// ── Parsing, shared by every runtime on the page ──────────────────────────

let parserReady: Promise<void> | null = null;
const grammars = new Map<CompiledLanguage, Promise<Language>>();

async function grammar(language: CompiledLanguage): Promise<Language> {
  await (parserReady ??= Parser.init({ locateFile: () => parserWasm }).catch((e) => { parserReady = null; throw e; }));
  if (!grammars.has(language)) {
    const loading = Language.load(language === 'c' ? cGrammar : javaGrammar);
    loading.catch(() => grammars.delete(language));
    grammars.set(language, loading);
  }
  return grammars.get(language)!;
}

async function parse<T>(language: CompiledLanguage, code: string, use: (root: Node) => T): Promise<T> {
  const parser = new Parser();
  parser.setLanguage(await grammar(language));
  const tree = parser.parse(code);
  try {
    return use(tree!.rootNode);
  } finally {
    tree?.delete();
    parser.delete();
  }
}

/** A compiler's complaint, as a syntax result pointing at the reader's line. */
/**
 * A compiler's complaint: its first error in its own words, where it points,
 * and everything it said, which the page shows in full.
 */
function compileError(language: CompiledLanguage, said: string, first: { message: string; line: number | null; column: number | null }): TraceResult {
  return {
    schema: 1, language, status: 'syntax', complete: false, steps: 0, stdout: '', stderr: said,
    error: { kind: 'syntax', type: 'CompileError', ...first },
  };
}

function rejected(language: CompiledLanguage, message: string, line?: number): TraceResult {
  return {
    schema: 1, language, status: 'rejected', complete: false, steps: 0, stdout: '', stderr: '',
    error: { kind: 'unsupported', type: 'Unsupported', message, line: line ?? null },
  };
}

// ── C, on clang in WebAssembly ────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type Emception = { mod: any; api: any };
let toolchain: Promise<Emception> | null = null;
/** The helper compiled with the toolchain it was compiled by. */
let helperBuilt: Promise<void> | null = null;

function loadToolchain(): Promise<Emception> {
  toolchain ??= import('@gameguild/emception-browser').then(async (mod: any) => ({
    mod,
    // Self-hosted by scripts/sync-emception.mjs, as for the notebook.
    api: await mod.createEmception({ manifestUrl: '/emception/manifest.json', tty: 'none' }),
  }));
  toolchain.catch(() => { toolchain = null; });
  return toolchain;
}

function killToolchain() {
  const dying = toolchain;
  toolchain = null;
  helperBuilt = null;
  void dying?.then((t) => t.api.dispose()).catch(() => {});
}

const DIR = '/home/user';
/** A compiler's words, without colour codes, and with "line 5:9:" for a scratch file's path. */
const tidy = (text: string, file: string) =>
  text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(new RegExp(`${DIR}/${file.replace('.', '\\.')}:(\\d+):(\\d+):`, 'g'), 'line $1:$2:')
    .replaceAll(`${DIR}/${file}`, 'the program')
    .trimEnd();

/** clang's arguments for `path`: -O0, so each line's work stays on its line. */
function clangArgs(preset: any, source: string, object: string, extra: string[]): string[] {
  const args: string[] = preset.compileArgv({ sourcePath: `${DIR}/${source}`, objectPath: `${DIR}/${object}`, wasmPath: '' })
    .map((a: string) => (a === '-O1' ? '-O0' : a));
  const input = args.indexOf('-x');
  args.splice(input === -1 ? args.length : input, 0, ...extra);
  return args;
}

/** `line 3:14: error: expected ';'` — clang's first error, from tidied text. */
function firstClangError(tidied: string) {
  const m = /^line (\d+):(\d+): (?:fatal )?error: (.+)$/m.exec(tidied);
  return m ? { message: m[3], line: Number(m[1]), column: Number(m[2]) } : { message: tidied.split('\n')[0] || 'The program did not compile.', line: null, column: null };
}

/** ecj's first error: "1. ERROR in Main.java (at line 3)", the line, a caret, then what is wrong. */
function firstJavaError(said: string) {
  const m = /ERROR in \S+ \(at line (\d+)\)\n[^\n]*\n[^\n]*\n([^\n]+)/.exec(said);
  return m ? { message: m[2].trim(), line: Number(m[1]), column: null }
    : { message: said.trim().split('\n')[0] || 'The program did not compile.', line: null, column: null };
}

/**
 * trace.c, compiled. clang here takes the better part of a minute for it, so
 * the object is kept in the toolchain's own storage, which outlives the page,
 * with a stamp of the source it came from: a later visit reuses it unless the
 * tracer itself has changed.
 */
async function buildHelper(t: Emception) {
  await t.api.workspace.writeFile(`${DIR}/trace.h`, traceHeader);
  const stamp = await traceKey({ language: 'c', code: traceHeader + traceRuntime, stdin: '', limits: DEFAULT_LIMITS });
  const read = async (name: string): Promise<Uint8Array | null> => {
    try {
      return (await t.api.workspace.readFile(`${DIR}/${name}`)) ?? null;
    } catch {
      return null;
    }
  };
  const [seen, object] = await Promise.all([read('trace.stamp'), read('trace.o')]);
  if (seen && object?.length && new TextDecoder().decode(seen) === stamp) {
    // Kept in storage is not the same as visible to the linker's process: put it back.
    await t.api.workspace.writeFile(`${DIR}/trace.o`, object);
    return;
  }
  await t.api.workspace.writeFile(`${DIR}/trace.c`, traceRuntime);
  const built = await t.api.run('clang', clangArgs(t.mod.TOOLCHAIN_PRESETS.c, 'trace.c', 'trace.o', []), { cwd: DIR });
  if (built.exitCode !== 0) throw new Error(`the tracer's own C did not compile: ${tidy(String(built.stderr), 'trace.c')}`);
  await t.api.workspace.writeFile(`${DIR}/trace.stamp`, stamp);
}

// ── Java, on CheerpJ ──────────────────────────────────────────────────────

let jvm: Promise<void> | null = null;
let javaBuild = 0;

function loadJvm(): Promise<void> {
  jvm ??= new Promise<void>((resolve, reject) => {
    const g = globalThis as any;
    if (g.cheerpjInit) return resolve();
    const tag = document.createElement('script');
    // CheerpJ's licence has it served from the vendor's own domain; the
    // notebook loads the same file (scripts/audit.mjs records the exception).
    tag.src = 'https://cjrtnc.leaningtech.com/4.2/loader.js';
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error('The Java runtime could not be fetched. Check the connection and try again.'));
    document.head.appendChild(tag);
  }).then(() => (globalThis as any).cheerpjInit({ version: 8, status: 'none' }));
  jvm.catch(() => { jvm = null; });
  return jvm;
}

/** Run `fn` with the console borrowed: CheerpJ writes System.out and System.err to it. */
async function withConsole<T>(onText: (text: string) => void, fn: () => Promise<T>): Promise<T> {
  const real = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  const take = (...parts: unknown[]) => onText(parts.join(' '));
  Object.assign(console, { log: take, error: take, warn: take, info: take });
  try {
    return await fn();
  } finally {
    Object.assign(console, real);
  }
}

// ── The runtime ───────────────────────────────────────────────────────────

/*
 * One program per toolchain at a time. A stopped run goes on compiling or
 * running until its own limits end it, and the next waits for it rather than
 * writing over the files it is still reading.
 */
const idle: Record<CompiledLanguage, Promise<unknown>> = { c: Promise.resolve(), java: Promise.resolve() };

/** A run that got as far as running, or the reason it did not. */
type Outcome = TraceResult | { reader: WireReader; exitCode: number | undefined; crash: string; builtAt: number };

interface Built {
  key: string;
  /** What it was built with: a toolchain killed and started again has none of its files. */
  by: unknown;
  conditions: ConditionMeta[];
  run: string;          // C: the wasm path; Java: the class directory
  tables?: string;
}

export class CompiledRuntime {
  private _state: RuntimeState = 'cold';
  private listeners = new Set<(s: RuntimeState) => void>();
  private cache = new LRU<{ steps: TraceStep[]; result: TraceResult }>(16);
  private built: Built | null = null;
  private abandon: (() => void) | null = null;
  private generation = 0;

  constructor(readonly language: CompiledLanguage) {}

  get state() {
    return this._state;
  }

  onStateChange(fn: (s: RuntimeState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(s: RuntimeState) {
    this._state = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Fetch the parser and the toolchain now, while the reader is still writing. */
  async warm(): Promise<void> {
    if (this._state === 'ready') return;
    this.setState('loading');
    try {
      await Promise.all([grammar(this.language), this.language === 'c' ? loadToolchain() : loadJvm()]);
      this.setState('ready');
    } catch (error) {
      this.setState('failed');
      throw error;
    }
  }

  cancel() {
    this.generation++;
    this.abandon?.();
  }

  dispose() {
    this.cancel();
    this.listeners.clear();
  }

  async trace(request: TraceRequest): Promise<TraceRun> {
    this.cancel();
    const generation = this.generation;
    const limits = { ...DEFAULT_LIMITS, ...request.limits };
    const code = request.code;
    const stdin = request.stdin ?? '';
    const key = await traceKey({ language: this.language, code, stdin, limits });
    const store = new TraceStore();

    const hit = this.cache.get(key);
    if (hit) {
      store.append(hit.steps);
      store.finish(hit.result);
      return { store, result: Promise.resolve(hit.result), cached: true, cancel: () => {} };
    }

    let settle!: (r: TraceResult) => void;
    const result = new Promise<TraceResult>((r) => { settle = r; });
    let ended = false;
    const finish = (r: TraceResult) => {
      if (ended) return;
      ended = true;
      if (this.abandon === cancel) this.abandon = null;
      store.finish(r);
      settle(r);
    };
    const cancel = () => finish({
      schema: 1, language: this.language, status: 'cancelled', complete: false, steps: store.length,
      stdout: store.length ? store.at(store.length - 1).stdout : '', stderr: '',
      stopped: { reason: 'cancelled', message: 'Stopped. The steps recorded so far are shown; the trace is incomplete.', step: store.length - 1 },
    });
    this.abandon = cancel;
    const live = () => !ended && generation === this.generation;

    const began = performance.now();
    void (async () => {
      try {
        if (code.length > limits.max_source) {
          finish(rejected(this.language, `The program is longer than ${limits.max_source.toLocaleString()} characters, the most the tracer reads.`));
          return;
        }
        let release!: () => void;
        const previous = idle[this.language];
        idle[this.language] = new Promise<void>((r) => { release = r; });
        let outcome: Outcome;
        try {
          await previous;
          if (!live()) return;
          outcome = this.language === 'c'
            ? await this.runC(code, stdin, limits, store, live)
            : await this.runJava(code, stdin, limits, store, live);
          if (this._state !== 'ready') this.setState('ready');
        } finally {
          release();
        }
        if (!live()) return;
        const r = 'status' in outcome ? outcome : resultOf(this.language, store, outcome.reader, limits, outcome.exitCode, outcome.crash, {
          parseMs: Math.round(outcome.builtAt - began),
          runMs: Math.round(performance.now() - outcome.builtAt),
          totalMs: Math.round(performance.now() - began),
          firstChunkMs: outcome.reader.firstStepAt === null ? undefined : Math.round(outcome.reader.firstStepAt - began),
        });
        if (r.status !== 'cancelled' && r.status !== 'crashed') this.cache.set(key, { steps: [...store.steps], result: r });
        finish(r);
      } catch (error) {
        if (this._state === 'loading') this.setState('failed');
        finish({
          schema: 1, language: this.language, status: 'crashed', complete: false, steps: store.length, stdout: '', stderr: '',
          error: { kind: 'crash', type: 'Error', message: error instanceof Error ? error.message : String(error) },
        });
      }
    })();

    return { store, result, cached: false, cancel };
  }

  /** Instrument, or say why not: a real compiler error first, if there is one. */
  private async instrument<T>(code: string, instrument: (root: Node, code: string) => T,
    original: () => Promise<TraceResult | null>): Promise<T | TraceResult> {
    try {
      return await parse(this.language, code, (root) => instrument(root, code));
    } catch (error) {
      if (!(error instanceof UnsupportedTrace)) throw error;
      // The compiler's own words are better than the parser's, when it has some.
      const compiled = await original();
      return compiled ?? rejected(this.language, error.message, error.line);
    }
  }

  private async runC(code: string, stdin: string, limits: TraceLimits, store: TraceStore, live: () => boolean): Promise<Outcome> {
    const t = await loadToolchain();
    const preset = t.mod.TOOLCHAIN_PRESETS.c;
    await (helperBuilt ??= buildHelper(t).catch((e) => { helperBuilt = null; throw e; }));

    const original = async (): Promise<TraceResult | null> => {
      await t.api.workspace.writeFile(`${DIR}/program.c`, code);
      const r = await t.api.run('clang', clangArgs(preset, 'program.c', 'original.o', []), { cwd: DIR });
      if (r.exitCode === 0) return null;
      const text = tidy(String(r.stderr), 'program.c');
      return compileError('c', text, firstClangError(text));
    };

    const codeKey = await traceKey({ language: 'c', code, stdin: '', limits: DEFAULT_LIMITS });
    if (this.built?.key !== codeKey || this.built.by !== t) {
      this.built = null;
      const done = await this.instrument(code, instrumentC, original);
      if ('status' in done) return done;
      // Stopped already: clang cannot be interrupted, so it is not started.
      if (!live()) return rejected('c', 'Stopped.');
      await t.api.workspace.writeFile(`${DIR}/program.c`, done.code);
      const compiled = await t.api.run('clang', clangArgs(preset, 'program.c', 'program.o', [
        '-include', `${DIR}/trace.h`, '-fsanitize=array-bounds,integer-divide-by-zero,null',
      ]), { cwd: DIR });
      if (compiled.exitCode !== 0) {
        const own = await original();
        if (own) return own;
        return rejected('c', `The tracer could not follow this program: ${tidy(String(compiled.stderr), 'program.c')}`);
      }
      if (!live()) return rejected('c', 'Stopped.');
      const link: string[] = preset.linkArgv({ sourcePath: '', objectPath: `${DIR}/program.o`, wasmPath: `${DIR}/program.wasm` });
      link.splice(2, 0, `${DIR}/trace.o`);
      link.push('-z', 'stack-size=4194304', '--initial-memory=33554432');
      const linked = await t.api.run(preset.linkTool, link, { cwd: DIR });
      if (linked.exitCode !== 0) return rejected('c', `The program did not link: ${tidy(String(linked.stderr), 'program.o')}`);
      this.built = { key: codeKey, by: t, conditions: done.conditions, run: `${DIR}/program.wasm` };
    }
    const builtAt = performance.now();
    if (!live()) return { reader: new WireReader(store, []), exitCode: undefined, crash: '', builtAt };

    const reader = new WireReader(store, this.built.conditions);
    const decoder = new TextDecoder();
    // The program's own clock starts with its first step; loading it does not count.
    let overdue = false;
    const kill = () => { overdue = true; killToolchain(); };
    let killer = setTimeout(kill, START_MS);
    let started = false;
    let ran: { exitCode: number; stderr?: string };
    try {
      ran = await t.api.run('wasi-run', ['wasi-run', this.built.run, stdin, String(limits.max_steps), String(limits.max_seconds), String(limits.max_output)], {
        cwd: DIR,
        stderr: (chunk: Uint8Array | string) => {
          if (!started) {
            started = true;
            clearTimeout(killer);
            killer = setTimeout(kill, limits.max_seconds * 1000 + HARD_GRACE_MS);
          }
          if (live()) reader.push(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
        },
      });
    } catch (error) {
      ran = { exitCode: -1, stderr: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(killer);
    }
    reader.push('\n');
    const crash = reader.ending ? ''
      : overdue ? 'it ran past its time limit without stopping itself, so it was stopped from outside'
      : clean(String(ran.stderr ?? '').split('\n').filter((l) => l && !l.startsWith('{')).join(' '));
    return { reader, exitCode: ran.exitCode, crash, builtAt };
  }

  private async runJava(code: string, stdin: string, limits: TraceLimits, store: TraceStore, live: () => boolean): Promise<Outcome> {
    await loadJvm();
    {
      const g = globalThis as any;
      const codeKey = await traceKey({ language: 'java', code, stdin: '', limits: DEFAULT_LIMITS });
      if (this.built?.key !== codeKey) {
        this.built = null;
        const compile = async (files: Record<string, string>, out: string) => {
          for (const [name, text] of Object.entries(files)) g.cheerpOSAddStringFile(`/str/${name}`, text);
          let said = '';
          const status = await withConsole((t) => { said += `${t}\n`; }, () => g.cheerpjRunMain(
            'org.eclipse.jdt.internal.compiler.batch.Main', '/app/java/ecj.jar',
            '-1.8', '-nowarn', '-encoding', 'UTF-8', '-bootclasspath', '/lt/8/jre/lib/rt.jar', '-d', out,
            ...Object.keys(files).map((name) => `/str/${name}`)));
          return { status, said };
        };
        const original = async (): Promise<TraceResult | null> => {
          const name = /\bpublic\s+(?:final\s+|abstract\s+)*(?:class|enum|interface)\s+([A-Za-z_$][\w$]*)/.exec(code)?.[1] ?? 'Main';
          const r = await compile({ [`${name}.java`]: code }, `/files/check${++javaBuild}`);
          if (r.status === 0) return null;
          const said = r.said.replaceAll(`/str/${name}.java`, `${name}.java`).trim();
          return compileError('java', said, firstJavaError(said));
        };
        const done = await this.instrument(code, instrumentJava, original);
        if ('status' in done) return done;
        if (!live()) return rejected('java', 'Stopped.');
        const out = `/files/trace${++javaBuild}`;
        const r = await compile({ [`${done.file}.java`]: done.code, 'OfficinaTrace.java': javaRuntime }, out);
        if (r.status !== 0) {
          const own = await original();
          if (own) return own;
          return rejected('java', `The tracer could not follow this program: ${r.said.trim()}`);
        }
        this.built = { key: codeKey, by: jvm, conditions: done.conditions, run: out, tables: done.tables };
      }
      const builtAt = performance.now();
      const reader = new WireReader(store, this.built.conditions);
      if (!live()) return { reader, exitCode: undefined, crash: '', builtAt };
      let exitCode: number | undefined;
      let crash = '';
      try {
        exitCode = await withConsole((t) => { if (live()) reader.push(t.endsWith('\n') ? t : `${t}\n`); }, () => g.cheerpjRunMain(
          'OfficinaTrace', this.built!.run, stdin, String(limits.max_steps), String(limits.max_seconds), String(limits.max_output), this.built!.tables));
      } catch (error) {
        crash = error instanceof Error ? error.message : String(error);
      }
      reader.push('\n');
      return { reader, exitCode, crash, builtAt };
    }
  }
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
