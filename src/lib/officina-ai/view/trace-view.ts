import type { TraceStore, StepView, FrameView, VariableChange } from '../trace/store.ts';
import type { Condition, TraceStep, TraceValue } from '../trace/schema.ts';
import { changedIndices, formatValue, isDefinition, typeOf } from './format.ts';
import { highlightPython } from './highlight.ts';

/**
 * The trace viewer: the program on the left with the running line marked,
 * the state on the right, the transport underneath.
 *
 * Every navigation — a button, a key, the scrubber, a frame of Play — ends
 * in show(n), which reads step n from the store and repaints. The store
 * never asks anything of the worker, so stepping costs the same whether the
 * program took a millisecond or five seconds to trace. show() times itself;
 * the budget is 50 ms (build guide §27.8) and a repaint is normally well under
 * one.
 */

export interface TraceView {
  readonly index: number;
  show(index: number): void;
  play(): void;
  pause(): void;
  /** Render times of recent steps, in milliseconds. */
  timings(): number[];
  destroy(): void;
}

export interface TraceViewOptions {
  source: string;
  store: TraceStore;
  /** Step to open on. Defaults to the first step. */
  start?: number;
  onStep?(view: StepView): void;
}

const SPEEDS = [1, 2, 4, 8, 16, 32];
const ROW = 28;                 // timeline row height, px
const OVERSCAN = 8;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function mountTraceView(root: HTMLElement, options: TraceViewOptions): TraceView {
  const { store, source } = options;
  const lines = highlightPython(source);

  root.classList.add('ot');
  root.tabIndex = 0;
  root.innerHTML = `
    <div class="ot-grid">
      <div class="ot-code" aria-label="Program">
        <ol class="ot-lines">${lines
          .map((html, i) => `<li class="ot-line" data-line="${i + 1}"><span class="ot-ln">${i + 1}</span><span class="ot-src">${html || ' '}</span></li>`)
          .join('')}</ol>
      </div>
      <div class="ot-side">
        <div class="ot-now" aria-live="polite"></div>
        <div class="ot-conds"></div>
        <section class="ot-panel">
          <h3 class="ot-h">Variables</h3>
          <div class="ot-vars"></div>
        </section>
        <section class="ot-panel">
          <h3 class="ot-h">Call stack</h3>
          <ol class="ot-stack"></ol>
        </section>
      </div>
    </div>
    <div class="ot-transport">
      <div class="ot-buttons">
        <button type="button" class="ot-btn" data-go="first" title="First step (Home)" aria-label="First step">|&lt;</button>
        <button type="button" class="ot-btn" data-go="prev" title="Previous step (←)" aria-label="Previous step">&lt;</button>
        <button type="button" class="ot-btn ot-play" data-go="play" title="Play / pause (Space)">▶ Play</button>
        <button type="button" class="ot-btn" data-go="next" title="Next step (→)" aria-label="Next step">&gt;</button>
        <button type="button" class="ot-btn" data-go="last" title="Last step (End)" aria-label="Last step">&gt;|</button>
        <button type="button" class="ot-btn" data-go="restart" title="Play from the start" aria-label="Restart">↻</button>
      </div>
      <input class="ot-scrub" type="range" min="0" max="0" value="0" aria-label="Step" />
      <span class="ot-count"></span>
      <label class="ot-speed">
        <span>Speed</span>
        <select aria-label="Steps per second">${SPEEDS.map((s) => `<option value="${s}" ${s === 4 ? 'selected' : ''}>${s}/s</option>`).join('')}</select>
      </label>
    </div>
    <div class="ot-out-wrap">
      <h3 class="ot-h">Output <span class="ot-h-note">up to this step</span></h3>
      <pre class="ot-out"></pre>
      <pre class="ot-out ot-err" hidden></pre>
    </div>
    <details class="ot-timeline-wrap">
      <summary class="ot-h">Timeline</summary>
      <div class="ot-timeline" role="listbox" aria-label="Steps"><div class="ot-tl-space"></div></div>
    </details>
  `;

  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const codeEl = $<HTMLElement>('.ot-code');
  const lineEls = [...root.querySelectorAll<HTMLElement>('.ot-line')];
  const nowEl = $<HTMLElement>('.ot-now');
  const condsEl = $<HTMLElement>('.ot-conds');
  const varsEl = $<HTMLElement>('.ot-vars');
  const stackEl = $<HTMLElement>('.ot-stack');
  const scrub = $<HTMLInputElement>('.ot-scrub');
  const countEl = $<HTMLElement>('.ot-count');
  const playBtn = $<HTMLButtonElement>('.ot-play');
  const speedEl = $<HTMLSelectElement>('.ot-speed select');
  const outEl = $<HTMLElement>('.ot-out');
  const errEl = $<HTMLElement>('.ot-err');
  const tl = $<HTMLElement>('.ot-timeline');
  const tlSpace = $<HTMLElement>('.ot-tl-space');

  let index = -1;
  let playing = false;
  let raf = 0;
  let marked: HTMLElement[] = [];
  let shownOut = '';
  const times: number[] = [];

  function show(target: number) {
    if (!store.length) return;
    const i = Math.max(0, Math.min(store.length - 1, target));
    const began = performance.now();
    const view = store.at(i);
    index = i;
    paintCode(view);
    paintNow(view);
    paintConditions(view.step.conditions);
    paintVariables(view);
    paintStack(view);
    paintOutput(view);
    paintTransport();
    if ((tl.parentElement as HTMLDetailsElement).open) followTimeline();
    paintTimeline();
    root.dataset.step = String(i);
    const took = performance.now() - began;
    times.push(took);
    if (times.length > 200) times.shift();
    options.onStep?.(view);
  }

  // ── Code ──

  function paintCode(view: StepView) {
    for (const el of marked) el.classList.remove('is-current', 'is-waiting', 'is-error');
    marked = [];
    const mark = (line: number, cls: string) => {
      const el = lineEls[line - 1];
      if (!el) return;
      el.classList.add(cls);
      marked.push(el);
    };
    const top = view.frames[view.frames.length - 1];
    for (const f of view.frames) if (f !== top && f.line > 0) mark(f.line, 'is-waiting');
    const { step } = view;
    if (step.line > 0) {
      mark(step.line, step.event === 'exception' ? 'is-error' : 'is-current');
      reveal(lineEls[step.line - 1]);
    }
  }

  /** Scroll the code pane — never the page — so the line is in view. */
  function reveal(el: HTMLElement | undefined) {
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < codeEl.scrollTop + 8) codeEl.scrollTop = Math.max(0, top - codeEl.clientHeight / 3);
    else if (bottom > codeEl.scrollTop + codeEl.clientHeight - 8) codeEl.scrollTop = bottom - (codeEl.clientHeight * 2) / 3;
  }

  // ── What happened ──

  function paintNow(view: StepView) {
    const { step } = view;
    const where = step.line > 0 ? `line ${step.line}` : 'start';
    const fn = step.function === '<module>' ? '' : ` · in <code>${esc(step.function)}()</code>`;
    nowEl.innerHTML = `
      <p class="ot-now-head">Step ${step.step + 1} of ${store.length.toLocaleString()}${store.done ? '' : '+'} · ${where}${fn}</p>
      <p class="ot-now-text">${describe(step, view)}</p>`;
  }

  function describe(step: TraceStep, view: StepView): string {
    const fn = `<code>${esc(step.function)}</code>`;
    switch (step.event) {
      case 'call': {
        if (step.function === '<module>') return 'The program starts.';
        const args = (step.args ?? []).map(([k, v]) => `${esc(k)}=${esc(formatValue(v, 40))}`).join(', ');
        const from = step.callerLine ? ` from line ${step.callerLine}` : '';
        return `Calls <code>${esc(step.function)}(${args})</code>${from}.`;
      }
      case 'return':
        if (step.function === '<module>') return step.unwinding ? 'The program stopped on an unhandled exception.' : 'The program finished.';
        if (step.unwinding) return `${fn} is left because an exception is passing through it.`;
        return `${fn} returns <code>${esc(formatValue(step.returnValue ?? null, 60))}</code>.`;
      case 'exception':
        return `<span class="ot-bad">${esc(step.exception?.type ?? 'Exception')}</span> raised: ${esc(step.exception?.message ?? '')}`;
      case 'line': {
        const parts: string[] = [];
        if (step.partial) parts.push('This line was cut off by the output limit before it finished.');
        if (step.loop?.iteration !== undefined) parts.push(`Loop on line ${step.loop.line}: iteration ${step.loop.iteration} begins.`);
        else if (step.loop?.done !== undefined) {
          const n = step.loop.done;
          parts.push(`Loop on line ${step.loop.line} ends after ${n} iteration${n === 1 ? '' : 's'}.`);
        }
        const own = view.changes.filter((c) => c.fid === step.fid);
        if (own.length) {
          parts.push(own.map((c) => (c.after === undefined ? `<code>${esc(c.name)}</code> deleted` : `<code>${esc(c.name)}</code> = <code>${esc(formatValue(c.after, 40))}</code>`)).join(', ') + '.');
        }
        if (step.stdout) parts.push(`Printed <code>${esc(formatValue(step.stdout.replace(/\n$/, ''), 60))}</code>.`);
        if (step.stdin) parts.push(`Read <code>${esc(formatValue(step.stdin.replace(/\n$/, ''), 40))}</code> from input.`);
        return parts.join(' ') || `Line ${step.line} ran.`;
      }
    }
  }

  function paintConditions(conds: Condition[] | undefined) {
    condsEl.innerHTML = (conds ?? [])
      .map((c) => `
        <div class="ot-cond" data-result="${c.result}">
          <p class="ot-cond-head"><span class="ot-cond-kind">${c.kind === 'ternary' ? 'if … else' : c.kind}</span>
            <code>${esc(c.expr)}</code> <span class="ot-cond-arrow">→</span> <strong>${c.result ? 'True' : 'False'}</strong></p>
          ${c.operands?.length ? `<ul class="ot-operands">${c.operands
            .map((o) => `<li><code>${esc(o.expr)}</code> ${o.skipped ? '<span class="ot-skip">not evaluated — the result was already decided</span>' : `= <code>${esc(formatValue(o.value ?? null, 60))}</code>`}</li>`)
            .join('')}</ul>` : ''}
        </div>`)
      .join('');
  }

  // ── State ──

  function paintVariables(view: StepView) {
    const changed = new Map<string, VariableChange>();
    for (const c of view.changes) changed.set(`${c.fid}:${c.name}`, c);
    const frames = [...view.frames].reverse();            // current first, globals last
    varsEl.innerHTML = frames
      .map((f, n) => {
        const label = f.function === '<module>' ? 'Global' : `${f.function}()`;
        const isModule = f.function === '<module>';
        const note = n === 0
          ? (f.returning ? (isModule ? 'finished' : 'returning') : 'current')
          : isModule ? '' : 'waiting';
        const rows = [...f.vars.entries()]
          .sort(([, a], [, b]) => Number(isDefinition(a)) - Number(isDefinition(b)))
          .map(([name, value]) => varRow(f, name, value, changed.get(`${f.fid}:${name}`)));
        const gone = view.changes.filter((c) => c.fid === f.fid && c.after === undefined);
        for (const g of gone) rows.push(`<tr class="ot-var is-deleted"><th>${esc(g.name)}</th><td colspan="2">deleted</td></tr>`);
        const ret = f.returning && view.step.returnValue !== undefined
          ? `<tr class="ot-var is-return"><th>return</th><td><code>${esc(formatValue(view.step.returnValue, 80))}</code></td><td class="ot-type">${esc(typeOf(view.step.returnValue))}</td></tr>`
          : '';
        return `
          <div class="ot-frame${n === 0 ? ' is-top' : ''}">
            <p class="ot-frame-head"><span>${esc(label)}</span>${note ? `<span class="ot-frame-note">${note}</span>` : ''}</p>
            ${rows.length || ret ? `<table class="ot-var-table"><tbody>${rows.join('')}${ret}</tbody></table>` : '<p class="ot-empty">No variables yet.</p>'}
          </div>`;
      })
      .join('');
  }

  function varRow(f: FrameView, name: string, value: TraceValue, change: VariableChange | undefined): string {
    const cls = ['ot-var'];
    if (isDefinition(value)) cls.push('is-def');
    let detail = '';
    if (change) {
      cls.push('is-changed');
      if (!change.existedBefore) detail = '<span class="ot-new">new</span>';
      else if (change.before !== undefined) {
        const idx = changedIndices(change.before, change.after);
        const before = change.before;
        const after = change.after;
        if (idx && idx.length && idx.length <= 3 && typeof before === 'object' && before && 'items' in before && typeof after === 'object' && after && 'items' in after) {
          detail = idx
            .map((i) => `<span class="ot-was"><code>${esc(name)}[${i}]</code> ${esc(formatValue((before.items as TraceValue[])[i], 24))} → ${esc(formatValue((after.items as TraceValue[])[i], 24))}</span>`)
            .join('');
        } else {
          detail = `<span class="ot-was">was ${esc(formatValue(before, 40))}</span>`;
        }
      }
    }
    return `<tr class="${cls.join(' ')}" data-fid="${f.fid}"><th>${esc(name)}</th><td><code>${esc(formatValue(value, 80))}</code>${detail}</td><td class="ot-type">${esc(typeOf(value))}</td></tr>`;
  }

  function paintStack(view: StepView) {
    stackEl.innerHTML = [...view.frames]
      .reverse()
      .map((f, n) => `<li class="${n === 0 ? 'is-top' : ''}"><code>${esc(f.function === '<module>' ? 'main program' : f.function + '()')}</code><span>line ${f.line || '—'}</span></li>`)
      .join('');
  }

  function paintOutput(view: StepView) {
    if (view.stdout !== shownOut) {
      if (view.stdout.startsWith(shownOut)) outEl.append(view.stdout.slice(shownOut.length));
      else outEl.textContent = view.stdout;
      shownOut = view.stdout;
    }
    outEl.classList.toggle('is-empty', !view.stdout);
    const result = store.result;
    const atEnd = store.done && index === store.length - 1;
    const lines: string[] = [];
    if (view.stderr) lines.push(view.stderr.replace(/\n$/, ''));
    if (atEnd && result?.error) {
      const e = result.error;
      lines.push(`${e.type}${e.line ? ` (line ${e.line})` : ''}: ${e.message}`);
    }
    if (atEnd && result?.stopped) lines.push(result.stopped.message);
    errEl.hidden = !lines.length;
    errEl.textContent = lines.join('\n');
  }

  // ── Transport ──

  function paintTransport() {
    scrub.max = String(Math.max(0, store.length - 1));
    scrub.value = String(index);
    countEl.textContent = `${(index + 1).toLocaleString()} / ${store.length.toLocaleString()}${store.done ? '' : ' …'}`;
    playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play';
    playBtn.setAttribute('aria-pressed', String(playing));
  }

  function play() {
    if (playing || !store.length) return;
    if (index >= store.length - 1 && store.done) show(0);
    playing = true;
    paintTransport();
    let last = performance.now();
    let owed = 0;
    const tick = (now: number) => {
      if (!playing) return;
      owed += ((now - last) / 1000) * Number(speedEl.value);
      last = now;
      const whole = Math.floor(owed);
      if (whole > 0) {
        owed -= whole;
        const target = Math.min(index + whole, store.length - 1);
        if (target !== index) show(target);
        if (index >= store.length - 1 && store.done) {
          pause();
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    paintTransport();
  }

  root.querySelector('.ot-buttons')!.addEventListener('click', (e) => {
    const go = (e.target as HTMLElement).closest<HTMLElement>('[data-go]')?.dataset.go;
    if (!go) return;
    if (go !== 'play') pause();
    if (go === 'first') show(0);
    else if (go === 'prev') show(index - 1);
    else if (go === 'next') show(index + 1);
    else if (go === 'last') show(store.length - 1);
    else if (go === 'restart') { show(0); play(); }
    else if (go === 'play') (playing ? pause : play)();
  });
  scrub.addEventListener('input', () => { pause(); show(Number(scrub.value)); });

  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches('input, select, textarea') && t !== scrub) return;
    const keys: Record<string, () => void> = {
      ArrowRight: () => { pause(); show(index + 1); },
      ArrowLeft: () => { pause(); show(index - 1); },
      Home: () => { pause(); show(0); },
      End: () => { pause(); show(store.length - 1); },
      ' ': () => (playing ? pause : play)(),
    };
    const fn = keys[e.key];
    if (fn) { e.preventDefault(); fn(); }
  });

  // Clicking a line jumps to the next time it runs.
  codeEl.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('.ot-line');
    if (!li) return;
    const visits = store.stepsOnLine(Number(li.dataset.line));
    if (!visits.length) return;
    pause();
    show(visits.find((s) => s > index) ?? visits[0]);
  });

  // ── Timeline: only the rows in view exist in the DOM ──

  let tlRows = new Map<number, HTMLElement>();
  function paintTimeline() {
    const wrap = tl.parentElement as HTMLDetailsElement;
    if (!wrap.open) return;
    tlSpace.style.height = `${store.length * ROW}px`;
    const first = Math.max(0, Math.floor(tl.scrollTop / ROW) - OVERSCAN);
    const last = Math.min(store.length - 1, Math.ceil((tl.scrollTop + tl.clientHeight) / ROW) + OVERSCAN);
    const keep = new Map<number, HTMLElement>();
    for (let i = first; i <= last; i++) {
      let row = tlRows.get(i);
      if (!row) {
        row = document.createElement('div');
        row.className = 'ot-tl-row';
        row.setAttribute('role', 'option');
        row.style.top = `${i * ROW}px`;
        row.dataset.i = String(i);
        row.innerHTML = timelineRow(store.steps[i]);
        tl.appendChild(row);
      }
      row.classList.toggle('is-current', i === index);
      row.setAttribute('aria-selected', String(i === index));
      keep.set(i, row);
    }
    for (const [i, row] of tlRows) if (!keep.has(i)) row.remove();
    tlRows = keep;
  }

  function followTimeline() {
    const top = index * ROW;
    if (top < tl.scrollTop || top > tl.scrollTop + tl.clientHeight - ROW) {
      tl.scrollTop = Math.max(0, top - tl.clientHeight / 2);
    }
  }

  tl.addEventListener('scroll', () => requestAnimationFrame(paintTimeline));
  tl.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.ot-tl-row');
    if (row) { pause(); show(Number(row.dataset.i)); }
  });
  tl.parentElement!.addEventListener('toggle', () => { paintTimeline(); followTimeline(); });

  // More steps arriving while the program is still being traced.
  const unsubscribe = store.subscribe(() => {
    if (!store.length) return;                      // ended before a single step
    if (index === -1) show(options.start ?? 0);
    else {
      paintTransport();
      paintTimeline();
      if (store.done) paintNow(store.at(index));
    }
  });

  if (store.length) show(options.start ?? 0);

  return {
    get index() { return index; },
    show,
    play,
    pause,
    timings: () => [...times],
    destroy() {
      pause();
      unsubscribe();
      root.innerHTML = '';
      root.classList.remove('ot');
    },
  };
}

function timelineRow(step: TraceStep): string {
  const fn = step.function === '<module>' ? '' : `<span class="ot-tl-fn">${esc(step.function)}</span>`;
  return `<span class="ot-tl-n">${step.step + 1}</span><span class="ot-tl-line">${step.line ? `L${step.line}` : ''}</span>${fn}<span class="ot-tl-what">${esc(summary(step))}</span>`;
}

function summary(step: TraceStep): string {
  switch (step.event) {
    case 'call':
      return step.function === '<module>' ? 'start' : `call ${step.function}(${(step.args ?? []).map(([, v]) => formatValue(v, 16)).join(', ')})`;
    case 'return':
      return step.function === '<module>' ? 'end' : step.unwinding ? 'unwinding' : `return ${formatValue(step.returnValue ?? null, 30)}`;
    case 'exception':
      return `${step.exception?.type}: ${step.exception?.message ?? ''}`;
    case 'line': {
      const bits: string[] = [];
      for (const c of step.conditions ?? []) bits.push(`${c.kind} → ${c.result ? 'True' : 'False'}`);
      if (step.loop?.iteration) bits.push(`iteration ${step.loop.iteration}`);
      if (step.loop?.done !== undefined) bits.push('loop ends');
      for (const c of (step.changes ?? []).filter((c) => c[0] === step.fid).slice(0, 2)) {
        bits.push(c.length === 3 ? `${c[1]} = ${formatValue(c[2], 20)}` : `del ${c[1]}`);
      }
      if (step.stdout) bits.push(`print ${formatValue(step.stdout.replace(/\n$/, ''), 20)}`);
      return bits.join(' · ');
    }
  }
}
