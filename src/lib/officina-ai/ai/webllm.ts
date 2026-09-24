/**
 * A model that runs in the reader's own browser.
 *
 * Chosen over a hosted API for what it does not need: no key, no proxy, no
 * bill, no request leaving the machine. The trace being explained is the
 * reader's own program, and on this arrangement it stays theirs.
 *
 * The price is the download — a couple of gigabytes, once per device — and
 * that price is only ever paid on purpose. Nothing in this file runs until
 * someone asks for the tutor: the library itself is behind a dynamic import
 * so it is a separate chunk, the weights are behind an explicit button, and
 * a visitor who never opens the tutor fetches not one byte of any of it.
 * The page this sits on took a fair amount of work to make quick; a model
 * that loaded itself eagerly would undo all of it.
 */
import type {
  Explanation, TutorLoadProgress, TutorProvider, TutorRequest, TutorChunk, TutorState,
} from './provider.ts';
import { stepsNamedIn } from './provider.ts';
import { buildPrompt } from './prompts.ts';
import type { StepView } from '../trace/store.ts';

export interface WebLLMModel {
  id: string;
  label: string;
  /** Approximate download, in gigabytes, for the reader to decide by. */
  gb: number;
  /** MLC's own judgement that it runs on modest hardware. */
  modest: boolean;
}

/**
 * The shortlist, from MLC's prebuilt catalogue.
 *
 * Coder-3B is the default because the job is reading Python, and because at
 * 2.4 GB it is the largest thing that MLC still marks as running on modest
 * hardware. The 7B is there for whoever has the machine for it; the Llama
 * 3.2 is the fallback for whoever finds Qwen unavailable.
 */
export const MODELS: WebLLMModel[] = [
  { id: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 Coder 3B', gb: 2.4, modest: true },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B', gb: 2.2, modest: true },
  { id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 Coder 7B', gb: 5.0, modest: false },
];

export const DEFAULT_MODEL = MODELS[0];

/** Enough room for the facts of one step plus an answer. */
const CONTEXT_WINDOW = 4096;
const MAX_ANSWER_TOKENS = 512;

type Engine = {
  chat: { completions: { create(request: unknown): Promise<AsyncIterable<unknown>> } };
  interruptGenerate(): void;
  unload(): Promise<void>;
};

interface ChunkShape { choices?: { delta?: { content?: string | null } }[] }

export interface WebLLMOptions {
  model?: WebLLMModel;
  /** How many steps the trace holds, so "step 12" can be checked before linking. */
  totalSteps(): number;
  read(index: number): StepView;
}

export class WebLLMProvider implements TutorProvider {
  readonly model: WebLLMModel;
  private engine: Engine | null = null;
  private worker: Worker | null = null;
  private loading: Promise<void> | null = null;
  private status: TutorState = 'absent';
  private readonly options: WebLLMOptions;

  constructor(options: WebLLMOptions) {
    this.options = options;
    this.model = options.model ?? DEFAULT_MODEL;
  }

  get name(): string {
    return `${this.model.label}, in this browser`;
  }

  get state(): TutorState {
    return this.status;
  }

  /**
   * WebGPU or nothing.
   *
   * Asking the adapter rather than trusting `navigator.gpu` to exist: Safari
   * and some Linux builds expose the object and then hand back no adapter,
   * and finding that out after a two-gigabyte download would be a poor way
   * to learn it.
   */
  async available(): Promise<boolean> {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    try {
      return (await gpu.requestAdapter()) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Whether this device has already paid for the download.
   *
   * Asked of the Cache Storage API rather than of `hasModelInCache`, which
   * would be the obvious call and is the wrong one here: importing the
   * library to ask the question fetches the library, and this is asked while
   * painting a panel nobody has clicked yet. The cache names are WebLLM's
   * own; being wrong about them costs a button that says "Download" when it
   * could have said "Start", which is the right way for this to fail.
   */
  async cached(): Promise<boolean> {
    try {
      if (!globalThis.caches) return false;
      const names = await caches.keys();
      if (!names.includes('webllm/model')) return false;
      const store = await caches.open('webllm/model');
      const entries = await store.keys();
      return entries.some((request) => request.url.includes(this.model.id));
    } catch {
      return false;
    }
  }

  async load(onProgress?: (p: TutorLoadProgress) => void): Promise<void> {
    if (this.status === 'ready') return;
    /* A second caller joins the first rather than starting a second
       download of the same two gigabytes. */
    if (this.loading) return this.loading;

    this.status = 'loading';
    this.loading = this.start(onProgress).then(
      () => { this.status = 'ready'; this.loading = null; },
      (error) => { this.status = 'failed'; this.loading = null; throw error; }
    );
    return this.loading;
  }

  private async start(onProgress?: (p: TutorLoadProgress) => void): Promise<void> {
    const webllm = await import('@mlc-ai/web-llm');

    this.worker = new Worker(new URL('./webllm-worker.ts', import.meta.url), { type: 'module' });

    this.engine = (await webllm.CreateWebWorkerMLCEngine(
      this.worker,
      this.model.id,
      {
        initProgressCallback: (report) => {
          onProgress?.({ progress: report.progress, text: report.text, ready: false });
        },
      },
      { context_window_size: CONTEXT_WINDOW }
    )) as unknown as Engine;

    onProgress?.({ progress: 1, text: 'Ready', ready: true });
  }

  async *answer(request: TutorRequest, signal: AbortSignal): AsyncIterable<TutorChunk> {
    if (this.status !== 'ready' || !this.engine) {
      yield { type: 'error', kind: 'not-loaded', message: 'The tutor has not been loaded yet.' };
      return;
    }

    const messages = buildPrompt(request, { read: this.options.read });
    let text = '';

    /* interruptGenerate is what actually stops the GPU; without it an
       abandoned answer keeps generating to its token limit behind the one
       the reader is now waiting for. */
    const stop = () => this.engine?.interruptGenerate();
    signal.addEventListener('abort', stop, { once: true });

    try {
      const stream = await this.engine.chat.completions.create({
        messages,
        stream: true,
        /* Low, not zero: these are explanations of fixed facts, and
           sampling variety buys nothing but the chance of a wrong one. */
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: MAX_ANSWER_TOKENS,
      });

      for await (const chunk of stream) {
        if (signal.aborted) break;
        const delta = (chunk as ChunkShape).choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          yield { type: 'delta', text: delta };
        }
      }

      if (signal.aborted) {
        yield { type: 'error', kind: 'cancelled', message: 'Stopped.' };
        return;
      }

      const explanation: Explanation = {
        task: request.task,
        text: text.trim(),
        steps: stepsNamedIn(text, this.options.totalSteps()),
        streaming: false,
      };
      yield { type: 'done', explanation };
    } catch (error) {
      if (signal.aborted) {
        yield { type: 'error', kind: 'cancelled', message: 'Stopped.' };
        return;
      }
      yield {
        type: 'error',
        kind: 'engine',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      signal.removeEventListener('abort', stop);
    }
  }

  async unload(): Promise<void> {
    try {
      await this.engine?.unload();
    } finally {
      this.worker?.terminate();
      this.worker = null;
      this.engine = null;
      this.status = 'absent';
    }
  }
}
