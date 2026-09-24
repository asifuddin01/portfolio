import type { Change, TraceResult, TraceStep, TraceValue } from './schema.ts';

/**
 * A trace held in memory, from which the state at any step can be read.
 *
 * This is where "compute once, step for free" is kept. The engine runs the
 * program once and sends steps; everything the viewer does afterwards —
 * Next, Previous, dragging the scrubber, each frame of Play — is a read from
 * here. Nothing in this file talks to a worker or the network.
 *
 * Steps carry changes, not whole states, so a 50,000-step trace stays small.
 * To make reading any step cheap anyway, the full state is copied every
 * CHECKPOINT steps as the steps arrive; reading step n clones the nearest
 * copy at or before it and replays at most CHECKPOINT − 1 steps.
 */
const CHECKPOINT = 256;

export interface FrameView {
  fid: number;
  function: string;
  depth: number;
  parent?: number;
  /** The line this frame is on: running, or waiting on a call it made. */
  line: number;
  vars: Map<string, TraceValue>;
  /** This frame is returning at the step being viewed. */
  returning?: boolean;
}

export interface VariableChange {
  fid: number;
  name: string;
  /** Absent when the variable did not exist before this step. */
  before?: TraceValue;
  /** Absent when the step deleted it. */
  after?: TraceValue;
  existedBefore: boolean;
}

export interface StepView {
  index: number;
  step: TraceStep;
  /** Outermost first; the last one is where execution is. */
  frames: FrameView[];
  changes: VariableChange[];
  stdout: string;
  stderr: string;
}

interface Snapshot {
  frames: Map<number, FrameView>;
  order: number[];
  /** A frame that returned on the previous step, removed before the next applies. */
  leaving: number | null;
}

const empty = (): Snapshot => ({ frames: new Map(), order: [], leaving: null });

function clone(s: Snapshot): Snapshot {
  const frames = new Map<number, FrameView>();
  for (const [fid, f] of s.frames) frames.set(fid, { ...f, vars: new Map(f.vars) });
  return { frames, order: [...s.order], leaving: s.leaving };
}

function apply(s: Snapshot, step: TraceStep, record?: VariableChange[]) {
  if (s.leaving !== null) {
    s.frames.delete(s.leaving);
    s.order = s.order.filter((f) => f !== s.leaving);
    s.leaving = null;
  }
  for (const f of s.frames.values()) f.returning = false;

  if (step.event === 'call') {
    s.frames.set(step.fid, {
      fid: step.fid, function: step.function, depth: step.depth,
      parent: step.parent, line: step.line, vars: new Map(),
    });
    s.order.push(step.fid);
    if (step.parent !== undefined && step.callerLine !== undefined) {
      const caller = s.frames.get(step.parent);
      if (caller) caller.line = step.callerLine;
    }
  }

  for (const change of step.changes ?? []) applyChange(s, change, record);

  const frame = s.frames.get(step.fid);
  if (frame) {
    frame.line = step.line;
    if (step.event === 'return') {
      frame.returning = true;
      s.leaving = step.fid;
    }
  }
}

function applyChange(s: Snapshot, change: Change, record?: VariableChange[]) {
  const [fid, name] = change;
  const frame = s.frames.get(fid);
  if (!frame) return;
  const existedBefore = frame.vars.has(name);
  const before = frame.vars.get(name);
  if (change.length === 3) {
    frame.vars.set(name, change[2]);
    record?.push({ fid, name, before, after: change[2], existedBefore });
  } else {
    frame.vars.delete(name);
    record?.push({ fid, name, before, existedBefore });
  }
}

export class TraceStore {
  readonly steps: TraceStep[] = [];
  result: TraceResult | null = null;

  private live = empty();
  private checkpoints: Snapshot[] = [];
  private outEnd: number[] = [];
  private errEnd: number[] = [];
  private out = '';
  private err = '';
  private byLine: Map<number, number[]> | null = null;
  private listeners = new Set<() => void>();

  get length() {
    return this.steps.length;
  }

  get done() {
    return this.result !== null;
  }

  /** Add steps as they arrive; they must continue the numbering. */
  append(batch: TraceStep[]) {
    for (const step of batch) {
      if (step.step !== this.steps.length) {
        throw new Error(`trace step ${step.step} arrived where ${this.steps.length} was expected`);
      }
      if (this.steps.length % CHECKPOINT === 0) this.checkpoints.push(clone(this.live));
      apply(this.live, step);
      if (step.stdout) this.out += step.stdout;
      if (step.stderr) this.err += step.stderr;
      this.outEnd.push(this.out.length);
      this.errEnd.push(this.err.length);
      this.steps.push(step);
    }
    this.byLine = null;
    this.notify();
  }

  finish(result: TraceResult) {
    this.result = result;
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    // A listener that throws must not stop the others, or the caller that
    // appended — the runtime, mid-message — from finishing its own work.
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        console.error('[officina] a trace listener failed', err);
      }
    }
  }

  /** The state after step `index` ran, and what that step changed. */
  at(index: number): StepView {
    if (index < 0 || index >= this.steps.length) {
      throw new RangeError(`step ${index} is outside 0…${this.steps.length - 1}`);
    }
    const k = Math.floor(index / CHECKPOINT);
    const s = clone(this.checkpoints[k]);
    for (let i = k * CHECKPOINT; i < index; i++) apply(s, this.steps[i]);
    const changes: VariableChange[] = [];
    apply(s, this.steps[index], changes);

    return {
      index,
      step: this.steps[index],
      frames: s.order.map((fid) => s.frames.get(fid)!).filter(Boolean),
      changes,
      stdout: this.out.slice(0, this.outEnd[index]),
      stderr: this.err.slice(0, this.errEnd[index]),
    };
  }

  /** Every step that ran `line`, for jumping between visits to it. */
  stepsOnLine(line: number): number[] {
    if (!this.byLine) {
      this.byLine = new Map();
      for (const s of this.steps) {
        if (s.event !== 'line') continue;
        const list = this.byLine.get(s.line);
        if (list) list.push(s.step);
        else this.byLine.set(s.line, [s.step]);
      }
    }
    return this.byLine.get(line) ?? [];
  }

  /** The first step at or after `from` where `fid` returns: "step out". */
  returnOf(fid: number, from: number): number | null {
    for (let i = from; i < this.steps.length; i++) {
      const s = this.steps[i];
      if (s.event === 'return' && s.fid === fid) return i;
    }
    return null;
  }
}
