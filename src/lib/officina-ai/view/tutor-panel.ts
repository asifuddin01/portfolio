/**
 * The tutor, as the reader meets it.
 *
 * Three things are on offer and all three are explicitly asked for: explain
 * this step, a question about it, a program written to order. What asking
 * sends is said beside the questions (`notice`). A provider that has to load
 * first — a model in the browser — gets a button that says what it costs
 * before anything is fetched; the site's own provider needs none.
 *
 * What comes back is kept visibly apart from the trace. The trace is what
 * the interpreter recorded; this is a model's account of it, and the panel
 * says so. Step numbers in an answer become links back into the timeline,
 * which is the one place the two are allowed to touch.
 */
import type { StepView } from '../trace/store.ts';
import type { TraceResult } from '../trace/schema.ts';
import type { TutorProvider, TutorRequest, TutorTask } from '../ai/provider.ts';

export interface TutorPanelOptions {
  provider: TutorProvider;
  /** The step in view, or null on the Code tab. */
  step(): StepView | null;
  source(): string;
  result(): TraceResult | undefined;
  /** Jump the viewer to a step named in an answer. */
  showStep(index: number): void;
  /** Put a solved program into the editor. Absent hides the solver. */
  useProgram?(code: string): void;
  /** How large a download the provider needs first, if any, for its button to say so. */
  downloadGB?: number;
  providerName: string;
  /** What asking sends, and where — said beside the questions. */
  notice?: string;
}

export interface TutorPanel {
  /** Re-render for a new step. Cheap; called on every step change. */
  refresh(): void;
  destroy(): void;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Prose: paragraphs, `inline code`, and step references turned into links. */
function prose(text: string): string {
  const html = esc(text.trim())
    .replace(/`([^`\n]+)`/g, '<code class="tu-inline">$1</code>')
    .replace(/\b(steps?)\s*#?\s*(\d+)/gi, '$1 <button type="button" class="tu-step" data-step="$2">$2</button>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return html ? `<p>${html}</p>` : '';
}

/**
 * An answer, as blocks.
 *
 * Code the model fences is shown as code, indentation and all — in Python the
 * indentation is the program, and prose rendering flattened it. A fence still
 * open while the answer streams is shown as code already. Everything is
 * escaped before any markup is added, so a model that emits a tag cannot open
 * one.
 */
export function renderAnswer(text: string): string {
  return text
    .split('```')
    .map((part, i) =>
      i % 2 === 1
        ? `<pre class="tu-code"><code>${esc(part.replace(/^[\w+-]*\n/, '').replace(/\n+$/, ''))}</code></pre>`
        : prose(part)
    )
    .join('');
}

/** The program out of a solver's answer, if it wrote one. */
export function codeFrom(text: string): string | null {
  const fenced = text.match(/```(?:python)?\n([\s\S]*?)```/);
  return fenced ? fenced[1].replace(/\s+$/, '') : null;
}

export function mountTutor(root: HTMLElement, options: TutorPanelOptions): TutorPanel {
  const { provider } = options;
  let running: AbortController | null = null;
  let supported: boolean | null = null;
  /** What the answer on screen was asked about, so a step change can date it. */
  let lastTask: TutorTask | null = null;

  root.classList.add('tu');
  root.innerHTML = `
    <header class="tu-head">
      <h3 class="tu-h">The tutor</h3>
      <p class="tu-by" hidden></p>
    </header>
    <p class="tu-note tu-notice" hidden></p>
    <div class="tu-gate"></div>
    <div class="tu-actions" hidden>
      <button type="button" class="tu-btn" data-task="explain">Explain this step</button>
      <form class="tu-ask">
        <label class="tu-label" for="tu-q">Ask about this step</label>
        <input id="tu-q" class="tu-input" type="text" autocomplete="off"
               placeholder="Why is j still 0 here?">
        <button type="submit" class="tu-btn">Ask</button>
      </form>
      ${options.useProgram ? `
      <form class="tu-solve">
        <label class="tu-label" for="tu-p">Ask for a program</label>
        <input id="tu-p" class="tu-input" type="text" autocomplete="off"
               placeholder="check whether a word is a palindrome">
        <button type="submit" class="tu-btn">Write it</button>
      </form>` : ''}
    </div>
    <div class="tu-out" hidden>
      <p class="tu-said">A model's account of what the interpreter recorded, not a second trace.</p>
      <div class="tu-answer" aria-live="polite"></div>
      <div class="tu-after"></div>
      <button type="button" class="tu-btn tu-stop" hidden>Stop</button>
    </div>
  `;

  const gate = root.querySelector<HTMLElement>('.tu-gate')!;
  const actions = root.querySelector<HTMLElement>('.tu-actions')!;
  const out = root.querySelector<HTMLElement>('.tu-out')!;
  const answer = root.querySelector<HTMLElement>('.tu-answer')!;
  const after = root.querySelector<HTMLElement>('.tu-after')!;
  const stop = root.querySelector<HTMLButtonElement>('.tu-stop')!;
  const by = root.querySelector<HTMLElement>('.tu-by')!;
  const notice = root.querySelector<HTMLElement>('.tu-notice')!;

  function say(html: string) {
    gate.innerHTML = html;
  }

  /** What the panel offers before anything has been downloaded. */
  async function paintGate() {
    if (supported === null) supported = await provider.available();
    if (!supported) {
      say(
        `<p class="tu-note">The tutor runs its model inside this browser, which needs WebGPU. ` +
        `This browser does not offer it, so the tutor is unavailable here — the trace itself is unaffected, ` +
        `since the interpreter produces that, not a model.</p>`
      );
      actions.hidden = true;
      return;
    }

    if (provider.state === 'ready') {
      gate.innerHTML = '';
      actions.hidden = false;
      by.hidden = false;
      by.textContent = options.providerName;
      notice.hidden = !options.notice;
      notice.textContent = options.notice ?? '';
      return;
    }

    const cached = provider.cached ? await provider.cached() : false;
    say(
      `<p class="tu-note">The tutor is a language model that runs entirely in this browser. ` +
      `It is downloaded once, from Hugging Face, where its publishers host it; after that, ` +
      `nothing you write or run leaves this device.</p>` +
      `<button type="button" class="tu-btn tu-load">${
        cached ? 'Start the tutor (already downloaded)'
               : options.downloadGB ? `Download the tutor (about ${options.downloadGB} GB, once)` : 'Start the tutor'
      }</button>` +
      `<p class="tu-progress" hidden></p>`
    );
    actions.hidden = true;
  }

  async function load() {
    const button = gate.querySelector<HTMLButtonElement>('.tu-load');
    const progress = gate.querySelector<HTMLElement>('.tu-progress');
    if (button) button.disabled = true;
    if (progress) progress.hidden = false;

    try {
      await provider.load((p) => {
        if (progress) {
          const pct = p.progress === undefined ? '' : ` ${Math.round(p.progress * 100)}%`;
          progress.textContent = `${p.text}${pct}`;
        }
      });
      await paintGate();
    } catch (error) {
      if (progress) {
        progress.textContent =
          `The tutor did not load: ${error instanceof Error ? error.message : String(error)}`;
      }
      if (button) button.disabled = false;
    }
  }

  async function ask(task: TutorTask, question?: string) {
    running?.abort();
    running = new AbortController();
    const signal = running.signal;

    out.hidden = false;
    answer.innerHTML = '<p class="tu-thinking">Thinking…</p>';
    after.innerHTML = '';
    stop.hidden = false;

    lastTask = task;
    out.classList.remove('tu-stale');
    const step = task === 'solve' ? undefined : options.step() ?? undefined;
    if (task !== 'solve' && !step) {
      answer.innerHTML = '<p class="tu-note">Trace the program first — there is no step to ask about yet.</p>';
      stop.hidden = true;
      return;
    }

    const request: TutorRequest = {
      task, source: options.source(), step, result: options.result(), question,
    };

    let text = '';
    try {
      for await (const chunk of provider.answer(request, signal)) {
        if (chunk.type === 'delta') {
          text += chunk.text;
          answer.innerHTML = renderAnswer(text);
        } else if (chunk.type === 'error') {
          /* A cancellation is the reader's own doing and needs no notice
             beyond leaving what had already arrived on screen. */
          if (chunk.kind !== 'cancelled') {
            answer.innerHTML = `<p class="tu-note">${esc(chunk.message)}</p>`;
          }
        } else {
          answer.innerHTML = renderAnswer(chunk.explanation.text);
          if (task === 'solve' && options.useProgram) offerProgram(chunk.explanation.text);
        }
      }
    } finally {
      stop.hidden = true;
      if (running?.signal === signal) running = null;
    }
  }

  function offerProgram(text: string) {
    const code = codeFrom(text);
    if (!code) return;
    after.innerHTML = '<button type="button" class="tu-btn tu-use">Put this in the editor</button>';
    after.querySelector('.tu-use')!.addEventListener('click', () => {
      options.useProgram?.(code);
      after.innerHTML = '<p class="tu-note">In the editor. Trace it to see what it actually does.</p>';
    });
  }

  function onClick(event: Event) {
    const target = event.target as HTMLElement;
    if (target.closest('.tu-load')) { void load(); return; }
    if (target.closest('.tu-stop')) { running?.abort(); return; }

    const stepButton = target.closest<HTMLElement>('.tu-step');
    if (stepButton) {
      const n = Number(stepButton.dataset.step);
      if (Number.isInteger(n)) options.showStep(n);
      return;
    }

    const task = target.closest<HTMLElement>('[data-task]')?.dataset.task as TutorTask | undefined;
    if (task) void ask(task);
  }

  function onSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const input = form.querySelector('input')!;
    const question = input.value.trim();
    if (!question) return;
    void ask(form.classList.contains('tu-solve') ? 'solve' : 'ask', question);
  }

  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  void paintGate();

  return {
    refresh() {
      /* The answer on screen was about the step that was in view when it was
         asked for. Once the reader moves, it is about somewhere else. */
      if (!out.hidden && running === null && lastTask !== null && lastTask !== 'solve') {
        out.classList.add('tu-stale');
      }
    },
    destroy() {
      running?.abort();
      root.removeEventListener('click', onClick);
      root.removeEventListener('submit', onSubmit);
      root.innerHTML = '';
    },
  };
}
