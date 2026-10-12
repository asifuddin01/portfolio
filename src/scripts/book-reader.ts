/**
 * The page-turning reader: a chapter laid out as a two-page spread (one page
 * on a phone) that turns with arrows, keys, a finger or the page slider.
 *
 * Pagination is CSS multi-column layout. The chapter's own article is moved,
 * live, into a box one page wide and one page tall with column-width set to
 * the page's text width; the browser flows it into as many columns as it
 * needs, and each column is a page. Turning is a translate. Because it is the
 * real article and not a copy, every link, figure, motion toggle and equation
 * keeps working inside the book, and it goes back where it came from on close.
 *
 * The turning leaf is the one place copies are used: a leaf has a front and a
 * back, and each face is a one-page window onto a static clone of the flow,
 * offset to the page it shows. Three clones are built on the first turn and
 * reused (under-page, leaf front, leaf back); they are inert, hidden from
 * assistive technology and stripped of ids.
 */

type Mode = 'flow' | 'plates';

interface Geo {
  spread: boolean;
  pageW: number;
  pageH: number;
  /** text width and height of a page */
  T: number;
  H: number;
  /** gap between columns: the two inner margins in a spread */
  G: number;
  /** outer and inner margins, top and bottom */
  mo: number;
  mi: number;
  mt: number;
  mb: number;
  fs: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const BLOCKS = 'h1, h2, h3, h4, p, figure, li, pre, table, blockquote, .katex-display, .art, dl > div';

interface Turn {
  from: number;
  to: number;
  layer: HTMLElement[];
  leaf: HTMLElement;
  shadeF: HTMLElement;
  shadeB: HTMLElement;
  cast: HTMLElement;
  /** -1 turns towards the left (forward), 1 towards the right (back). */
  sign: 1 | -1;
  t: number;
  target: 0 | 1;
}

/**
 * The sound of a page turning, made fresh each time with the Web Audio API
 * rather than played from a file, so that no two turns sound the same: the
 * dry crackle of the sheet coming off the stack, the swish of air as it
 * crosses (noise through a band-pass that sweeps up and back, with a shallow
 * flutter in it), and the soft slap of it landing.
 *
 * Switched off from the button in the reader's bar, and remembered. The audio
 * context is created inside a turn the reader made, which is what browsers
 * require before they allow sound.
 */
class PageSound {
  on = true;
  ctx: AudioContext | null = null;
  noise: AudioBuffer | null = null;

  constructor() {
    try { this.on = localStorage.getItem('codex-book-sound') !== 'off'; } catch { /* storage blocked: on */ }
  }

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('codex-book-sound', this.on ? 'on' : 'off'); } catch { /* not remembered */ }
    if (this.on) this.flip(0.6);
  }

  flip(level = 1) {
    if (!this.on) return;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx ??= new AC());
      if (ctx.state === 'suspended') void ctx.resume();
      if (!this.noise) {
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const r = (a: number, b: number) => a + Math.random() * (b - a);
      const t = ctx.currentTime + 0.01;
      // Slower than a quick riffle: a single page turned by a reader in no
      // hurry. The owner heard the crisp version as real and asked only that
      // it be slower and smoother, so the character is that one's.
      const len = r(0.52, 0.64);
      const out = ctx.createGain();
      out.gain.value = 0.55 * level;
      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = 7000;
      out.connect(air).connect(ctx.destination);
      const noise = () => {
        const s = ctx.createBufferSource();
        s.buffer = this.noise;
        s.loop = true;
        s.start(t, r(0, 0.5));
        s.stop(t + len + 0.15);
        return s;
      };

      // The swish: air across a moving sheet.
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = r(0.6, 0.85);
      bp.frequency.setValueAtTime(r(700, 1000), t);
      bp.frequency.exponentialRampToValueAtTime(r(2600, 3600), t + len * 0.38);
      bp.frequency.exponentialRampToValueAtTime(r(1100, 1500), t + len * 0.86);
      const g = ctx.createGain();
      const curve = new Float32Array(40);
      for (let i = 0; i < curve.length; i++) {
        const k = i / (curve.length - 1);
        // A sheet of paper is not rigid, so there is a flutter in it; kept
        // shallow, so the swish is smooth rather than ragged.
        curve[i] = Math.pow(Math.sin(Math.PI * Math.min(1, k * 1.12)), 1.5) * r(0.78, 1) * 0.9;
      }
      g.gain.setValueAtTime(0, t);
      g.gain.setValueCurveAtTime(curve, t, len * 0.9);
      noise().connect(bp).connect(g).connect(out);

      // The crackle: a few dry ticks of paper fibre as the sheet lifts.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 4200;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0, t);
      const ticks = Array.from({ length: 7 }, () => t + r(0, len * 0.5)).sort((x, y) => x - y);
      for (const at of ticks) {
        cg.gain.setValueAtTime(r(0.08, 0.2), at);
        cg.gain.setValueAtTime(0, at + r(0.004, 0.012));
      }
      noise().connect(hp).connect(cg).connect(out);

      // The landing: a soft, low slap as the page settles.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = r(500, 750);
      const sg = ctx.createGain();
      const land = t + len * r(0.8, 0.88);
      sg.gain.setValueAtTime(0, t);
      sg.gain.setValueAtTime(0, land);
      sg.gain.linearRampToValueAtTime(r(0.4, 0.55), land + 0.008);
      sg.gain.exponentialRampToValueAtTime(0.001, land + 0.09);
      noise().connect(lp).connect(sg).connect(out);
    } catch {
      /* no sound is better than a broken turn */
    }
  }
}

let reader: Reader | null = null;

class Reader {
  root!: HTMLElement;
  book!: HTMLElement;
  windowEl!: HTMLElement;
  flow!: HTMLElement;
  end!: HTMLElement;
  pagesEl!: [HTMLElement, HTMLElement];
  countEl!: HTMLElement;
  seek!: HTMLInputElement;
  geo!: Geo;
  pages = 1;
  page = 0;
  clones: HTMLElement[] = [];
  /** The leaf in motion, whether a button sent it or a finger is holding it. */
  active: Turn | null = null;
  raf = 0;
  sliding: Animation | null = null;
  sound = new PageSound();
  placeholder = document.createComment('book-reader');
  relayoutTimer = 0;
  still = !document.documentElement.classList.contains('js');

  constructor(
    readonly source: HTMLElement,
    readonly opener: HTMLElement,
    readonly head: string,
    readonly title: string,
    readonly mode: Mode,
  ) {}

  open() {
    const anchor = firstVisible(this.source);
    this.build();
    this.source.before(this.placeholder);
    this.flow.prepend(this.source);
    for (const img of this.source.querySelectorAll<HTMLImageElement>('img[loading="lazy"]')) img.loading = 'eager';
    document.documentElement.classList.add('br-is-open');
    this.layout();
    this.goTo(anchor ? this.pageOf(anchor) : 0, false);
    this.root.focus({ preventScroll: true });
  }

  close() {
    const anchor = this.blockOnPage(this.page);
    this.finishTurn();
    this.placeholder.replaceWith(this.source);
    this.root.remove();
    document.documentElement.classList.remove('br-is-open');
    window.removeEventListener('resize', this.onResize);
    if (anchor) {
      const top = anchor.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({ top: Math.max(0, top), behavior: 'instant' as ScrollBehavior });
    }
    this.opener.focus({ preventScroll: true });
    reader = null;
  }

  /* ---------------------------------------------------------------- DOM */

  build() {
    const main = document.querySelector<HTMLElement>('main[data-book]');
    const root = el('div', 'br');
    root.dataset.book = main?.dataset.book ?? 'elementa';
    root.dataset.mode = this.mode;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', `${this.title}, as a book`);
    root.tabIndex = -1;

    const bar = el('div', 'br-bar');
    const name = el('p', 'br-name');
    name.textContent = this.head ? `${this.head} · ${this.title}` : this.title;
    this.countEl = el('p', 'br-count');
    this.countEl.setAttribute('aria-live', 'polite');
    const close = el('button', 'br-close');
    close.type = 'button';
    close.innerHTML = '<span>Close the book</span><span aria-hidden="true">×</span>';
    close.addEventListener('click', () => this.close());
    const sound = el('button', 'br-sound');
    sound.type = 'button';
    const paintSound = () => {
      sound.setAttribute('aria-pressed', String(this.sound.on));
      sound.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/>${
        this.sound.on
          ? '<path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
          : '<path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
      }</svg><span>${this.sound.on ? 'Sound on' : 'Sound off'}</span>`;
    };
    sound.addEventListener('click', () => { this.sound.toggle(); paintSound(); });
    paintSound();
    bar.append(name, this.countEl, sound, close);

    const stage = el('div', 'br-stage');
    const prev = turnButton('prev', 'Previous page');
    const next = turnButton('next', 'Next page');
    prev.addEventListener('click', () => this.turn(-1));
    next.addEventListener('click', () => this.turn(1));

    this.book = el('div', 'br-book');
    const left = page('l', this.head || this.title);
    const right = page('r', this.title);
    this.pagesEl = [left, right];
    this.windowEl = el('div', 'br-window');
    this.flow = el('div', 'br-flow');
    this.end = el('span', 'br-end');
    this.flow.append(this.end);
    this.windowEl.append(this.flow);
    this.book.append(left, right, this.windowEl);
    stage.append(prev, this.book, next);

    const foot = el('div', 'br-foot');
    this.seek = el('input', 'br-seek');
    this.seek.type = 'range';
    this.seek.min = '0';
    this.seek.step = '1';
    this.seek.setAttribute('aria-label', 'Turn to page');
    this.seek.addEventListener('input', () => this.goTo(Number(this.seek.value) * this.perView(), false));
    foot.append(this.seek);

    root.append(bar, stage, foot);
    document.body.append(root);
    this.root = root;

    root.addEventListener('keydown', this.onKey);
    // Focus can scroll an overflow:hidden box; the window never scrolls, it
    // turns. A link focused on another page brings that page round instead.
    this.windowEl.addEventListener('scroll', () => { this.windowEl.scrollLeft = 0; this.windowEl.scrollTop = 0; });
    this.flow.addEventListener('focusin', (e) => {
      const t = e.target as HTMLElement;
      const p = this.pageOf(t);
      if (p < this.page || p >= this.page + this.perView()) this.goTo(p, false);
    });
    this.flow.addEventListener('click', this.onLink);
    // A late image changes where every later page breaks.
    this.flow.addEventListener('load', () => this.relayoutSoon(), true);
    window.addEventListener('resize', this.onResize);
    this.drag(stage);
  }

  /* ------------------------------------------------------------- layout */

  measure(): Geo {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spread = vw >= 900 && vw / vh > 1.05;
    const side = spread ? clamp(vw * 0.035, 30, 64) : 4;
    const pageH = Math.floor(vh - (spread ? 104 : 96));
    // As wide as the screen allows: the owner wants more words to the line
    // and less bare desk. The cap only keeps a line from running past what an
    // eye can track on a very wide monitor.
    const pageW = Math.floor(Math.min(spread ? (vw - 2 * side) / 2 : vw - 2 * side, spread ? 780 : 720));
    const mo = Math.round(spread ? clamp(pageW * 0.085, 28, 66) : clamp(pageW * 0.065, 16, 34));
    const mi = Math.round(spread ? clamp(pageW * 0.06, 22, 46) : mo);
    const mt = Math.round(clamp(pageH * 0.075, 38, 62));
    const mb = Math.round(clamp(pageH * 0.075, 38, 60));
    const T = pageW - mo - mi;
    const H = pageH - mt - mb;
    const G = spread ? 2 * mi : 2 * mo;
    const fs = Math.round(clamp(T / 30, 15, 20) * 10) / 10;
    return { spread, pageW, pageH, T, H, G, mo, mi, mt, mb, fs };
  }

  layout() {
    const g = (this.geo = this.measure());
    const r = this.root.style;
    r.setProperty('--br-page-w', `${g.pageW}px`);
    r.setProperty('--br-page-h', `${g.pageH}px`);
    r.setProperty('--br-t', `${g.T}px`);
    r.setProperty('--br-h', `${g.H}px`);
    r.setProperty('--br-g', `${g.G}px`);
    r.setProperty('--br-mo', `${g.mo}px`);
    r.setProperty('--br-mi', `${g.mi}px`);
    r.setProperty('--br-mt', `${g.mt}px`);
    r.setProperty('--br-mb', `${g.mb}px`);
    r.setProperty('--br-fs', `${g.fs}px`);
    this.root.classList.toggle('is-spread', g.spread);
    this.clones = [];
    this.count();
  }

  count() {
    const stride = this.geo.T + this.geo.G;
    const fr = this.flow.getBoundingClientRect();
    const er = this.end.getBoundingClientRect();
    this.pages = Math.max(1, Math.floor((er.left - fr.left + 1) / stride) + 1);
    this.seek.max = String(Math.max(0, Math.ceil(this.pages / this.perView()) - 1));
  }

  relayoutSoon = () => {
    window.clearTimeout(this.relayoutTimer);
    this.relayoutTimer = window.setTimeout(() => {
      const anchor = this.blockOnPage(this.page);
      this.finishTurn();
      this.layout();
      this.goTo(anchor ? this.pageOf(anchor) : this.page, false);
    }, 120);
  };
  onResize = () => this.relayoutSoon();

  perView() { return this.geo.spread ? 2 : 1; }

  /** Which page (column) an element starts on. */
  pageOf(node: Element): number {
    const stride = this.geo.T + this.geo.G;
    const fr = this.flow.getBoundingClientRect();
    const box = node.getClientRects()[0] ?? node.getBoundingClientRect();
    return clamp(Math.floor((box.left - fr.left + 1) / stride), 0, this.pages - 1);
  }

  blockOnPage(p: number): Element | null {
    const all = this.source.querySelectorAll(BLOCKS);
    if (!this.root?.isConnected) return null;
    for (const b of all) {
      if ((b as HTMLElement).offsetParent === null && !(b instanceof SVGElement)) continue;
      if (this.pageOf(b) >= p) return b;
    }
    return null;
  }

  /* -------------------------------------------------------------- turning */

  /** The first page of the view that holds page `p`. */
  viewOf(p: number): number {
    const per = this.perView();
    return clamp(Math.floor(p / per) * per, 0, Math.max(0, (Math.ceil(this.pages / per) - 1) * per));
  }

  goTo(p: number, animate: boolean) {
    this.finishTurn();
    const from = this.page;
    const target = this.viewOf(p);
    if (target === from) { this.place(); return; }
    if (animate && !this.still && Math.abs(target - from) === this.perView()) {
      const turn = this.beginTurn(from, target);
      this.sound.flip();
      void this.runTurn(turn, 1, 760);
      return;
    }
    if (animate && !this.still) this.slide(from, target);
    this.page = target;
    this.place();
  }

  turn(dir: 1 | -1) {
    this.goTo(this.page + dir * this.perView(), true);
  }

  place() {
    const { T, G } = this.geo;
    this.flow.style.transform = `translateX(${-this.page * (T + G)}px)`;
    const per = this.perView();
    const [l, r] = this.pagesEl;
    folio(l, this.page + 1);
    folio(r, this.page + 2 <= this.pages ? this.page + 2 : 0);
    r.hidden = !this.geo.spread;
    this.seek.value = String(Math.floor(this.page / per));
    const last = Math.min(this.page + per, this.pages);
    this.countEl.textContent =
      per === 2 && last > this.page + 1
        ? `Pages ${this.page + 1}–${last} of ${this.pages}`
        : `Page ${this.page + 1} of ${this.pages}`;
    this.root.querySelector<HTMLButtonElement>('.br-turn--prev')!.disabled = this.page === 0;
    this.root.querySelector<HTMLButtonElement>('.br-turn--next')!.disabled = this.page + per >= this.pages;
  }

  /** A static, inert copy of the flow, for the faces of a turning leaf. */
  clone(): HTMLElement {
    const pooled = this.clones.pop();
    if (pooled) return pooled;
    const c = this.flow.cloneNode(true) as HTMLElement;
    c.classList.add('br-flow--copy');
    c.setAttribute('aria-hidden', 'true');
    c.inert = true;
    for (const n of c.querySelectorAll('[id]')) n.removeAttribute('id');
    for (const f of c.querySelectorAll('iframe')) f.removeAttribute('src');
    for (const v of c.querySelectorAll('video, audio')) { v.removeAttribute('src'); v.removeAttribute('autoplay'); }
    return c;
  }

  /** A page-sized sheet showing page `p`, laid out as a left or right page. */
  sheetFor(p: number, side: 'l' | 'r', cls: string): HTMLElement {
    const s = page(side, side === 'l' ? this.head || this.title : this.title);
    s.classList.add(cls);
    folio(s, p < this.pages ? p + 1 : 0);
    const win = el('div', 'br-window');
    const f = this.clone();
    f.style.transform = `translateX(${-p * (this.geo.T + this.geo.G)}px)`;
    win.append(f);
    s.append(win);
    if (p >= this.pages) win.hidden = true;
    return s;
  }

  /**
   * Lays out a leaf about to turn from view `from` to view `to`, and moves the
   * live text to `to` underneath it. Nothing moves until setTurn is called.
   *
   * In a spread the leaf is the right-hand page going forward (the left-hand
   * page going back), hinged on the binding in the middle; the page it
   * uncovers on the far side is held by a copy until the leaf lands on it.
   *
   * On a phone there is one page, so the spine moves to whichever edge the
   * turn needs: forward the page is hinged on its left edge and swings away to
   * the left, back it is hinged on its right edge and swings away to the
   * right. Either way the page underneath is already the one being turned to,
   * and the motion follows the finger.
   */
  beginTurn(from: number, to: number): Turn {
    const fwd = to > from;
    const spread = this.geo.spread;
    let under: HTMLElement | null = null;
    let front: HTMLElement;
    let back: HTMLElement;
    let cls: string;
    let castSide: 'l' | 'r';
    if (spread) {
      under = fwd ? this.sheetFor(from, 'l', 'br-under') : this.sheetFor(from + 1, 'r', 'br-under');
      front = fwd ? this.sheetFor(from + 1, 'r', 'br-face') : this.sheetFor(from, 'l', 'br-face');
      back = fwd ? this.sheetFor(from + 2, 'l', 'br-face') : this.sheetFor(from - 1, 'r', 'br-face');
      cls = fwd ? 'br-leaf--fwd' : 'br-leaf--back';
      castSide = fwd ? 'r' : 'l';
    } else {
      front = this.sheetFor(from, 'l', 'br-face');
      back = page('l', '');
      back.classList.add('br-face', 'is-blank');
      cls = fwd ? 'br-leaf--single-fwd' : 'br-leaf--single-back';
      castSide = fwd ? 'l' : 'r';
    }
    back.classList.add('br-face--back');
    const leaf = el('div', `br-leaf ${cls}`);
    const shadeF = el('div', 'br-shade');
    const shadeB = el('div', 'br-shade');
    front.append(shadeF);
    back.append(shadeB);
    leaf.append(front, back);
    // The shadow the lifted leaf throws on the page it uncovers, deepest at
    // the hinge.
    const cast = el('div', `br-cast br-cast--${spread ? castSide : `single-${castSide}`}`);
    const layer = [under, cast, leaf].filter((n): n is HTMLElement => n !== null);
    this.book.append(...layer);
    const sign = fwd ? -1 : 1;
    const turn: Turn = { from, to, layer, leaf, shadeF, shadeB, cast, sign, t: 0, target: 1 };
    this.active = turn;
    this.page = to;
    this.place();
    this.setTurn(turn, 0);
    return turn;
  }

  /** Puts the leaf at `t` of the way through its turn, 0 to 1. */
  setTurn(turn: Turn, t: number) {
    turn.t = t;
    turn.leaf.style.transform = `rotateY(${turn.sign * 180 * t}deg)`;
    // The face tipping away from the light darkens; the face coming down
    // towards it brightens again as it lands.
    turn.shadeF.style.opacity = String(Math.min(0.6, t * 1.1));
    turn.shadeB.style.opacity = String(Math.min(0.6, (1 - t) * 1.1));
    turn.cast.style.opacity = String(Math.sin(Math.PI * t) * 0.85);
  }

  /** Carries a turn to `target`: 1 completes it, 0 lays the leaf back down. */
  runTurn(turn: Turn, target: 0 | 1, ms: number): Promise<void> {
    cancelAnimationFrame(this.raf);
    turn.target = target;
    const t0 = turn.t;
    const start = performance.now();
    const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    return new Promise((done) => {
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / Math.max(1, ms));
        this.setTurn(turn, t0 + (target - t0) * ease(k));
        if (k < 1) this.raf = requestAnimationFrame(step);
        else { this.endTurn(turn); done(); }
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  /** A turn laid back undoes itself: the text returns to where it was. */
  endTurn(turn: Turn) {
    if (this.active !== turn) return;
    if (turn.target === 0) {
      this.page = turn.from;
      this.place();
    }
    this.clearTurn();
  }

  /** A jump of more than one page (a note link) slides rather than turns. */
  slide(from: number, to: number) {
    const { T, G } = this.geo;
    this.sliding = this.flow.animate(
      [
        { transform: `translateX(${-from * (T + G)}px)`, opacity: 1 },
        { transform: `translateX(${-(from + (to - from) * 0.5) * (T + G)}px)`, opacity: 0.35, offset: 0.5 },
        { transform: `translateX(${-to * (T + G)}px)`, opacity: 1 },
      ],
      { duration: 260, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
    );
  }

  finishTurn() {
    cancelAnimationFrame(this.raf);
    try { this.sliding?.finish(); } catch { /* already done */ }
    this.sliding = null;
    if (this.active) this.endTurn(this.active);
  }

  clearTurn() {
    for (const n of this.active?.layer ?? []) {
      // Hand the copies back to the pool before the sheet goes.
      for (const c of n.querySelectorAll<HTMLElement>('.br-flow--copy')) {
        c.remove();
        if (this.clones.length < 3) this.clones.push(c);
      }
      n.remove();
    }
    this.active = null;
  }

  /* --------------------------------------------------------------- input */

  onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) {
      if (e.key === 'Escape') this.close();
      return;
    }
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); this.close(); }
    else if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { e.preventDefault(); this.turn(1); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { e.preventDefault(); this.turn(-1); }
    else if (k === 'Home') { e.preventDefault(); this.finishTurn(); this.goTo(0, false); }
    else if (k === 'End') { e.preventDefault(); this.finishTurn(); this.goTo(this.pages - 1, false); }
    else if (k === 'Tab') this.trapTab(e);
  };

  trapTab(e: KeyboardEvent) {
    const items = [...this.root.querySelectorAll<HTMLElement>('button:not([disabled]), input, a[href]')]
      .filter((n) => !n.closest('.br-flow--copy') && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /** A note reference or a "back to text" link turns to its page. */
  onLink = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href*="#"]');
    if (!a || a.pathname !== location.pathname) return;
    const id = decodeURIComponent(a.hash.slice(1));
    const target = id && document.getElementById(id);
    if (!target || !this.flow.contains(target)) return;
    e.preventDefault();
    this.finishTurn();
    this.goTo(this.pageOf(target), true);
  };

  /**
   * A finger (or a pen) takes hold of the page. The leaf follows it; let go a
   * third of the way over, or with a flick, and the turn completes, otherwise
   * the page settles back. A tap moves nothing, so links in the text still
   * open.
   */
  drag(stage: HTMLElement) {
    let id = -1;
    let x0 = 0;
    let y0 = 0;
    let dir: 1 | -1 = 1;
    let held: Turn | null = null;
    let lastX = 0;
    let lastT = 0;
    let vx = 0;
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || id !== -1) return;
      this.finishTurn();
      id = e.pointerId;
      x0 = lastX = e.clientX;
      y0 = e.clientY;
      lastT = e.timeStamp;
      vx = 0;
      held = null;
    });
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (!held) {
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        dir = dx < 0 ? 1 : -1;
        const to = this.viewOf(this.page + dir * this.perView());
        if (to === this.page || this.still) { id = -1; return; }
        held = this.beginTurn(this.page, to);
        this.sound.flip();
        try { stage.setPointerCapture(id); } catch { /* the pointer has already gone */ }
      }
      const span = this.geo.spread ? this.geo.pageW * 1.5 : this.geo.pageW * 0.85;
      this.setTurn(held, clamp((dir === 1 ? -dx : dx) / span, 0, 1));
      vx = (e.clientX - lastX) / Math.max(1, e.timeStamp - lastT);
      lastX = e.clientX;
      lastT = e.timeStamp;
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      if (!held) return;
      const turn = held;
      held = null;
      const flick = (dir === 1 ? -vx : vx) > 0.45;
      const go = e.type !== 'pointercancel' && (turn.t > 0.33 || flick);
      void this.runTurn(turn, go ? 1 : 0, go ? 140 + 520 * (1 - turn.t) : 120 + 360 * turn.t);
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
  }
}

/* ----------------------------------------------------------------- helpers */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  return n;
}

function page(side: 'l' | 'r', head: string): HTMLElement {
  const p = el('div', `br-page br-page--${side}`);
  const rh = el('span', 'br-rh');
  rh.textContent = head;
  const f = el('span', 'br-folio');
  p.append(rh, f);
  return p;
}

function folio(p: HTMLElement, n: number) {
  p.querySelector('.br-folio')!.textContent = n > 0 ? String(n) : '';
  p.classList.toggle('is-blank', n === 0);
}

function turnButton(dir: 'prev' | 'next', label: string): HTMLButtonElement {
  const b = el('button', `br-turn br-turn--${dir}`);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${dir === 'prev' ? 'M15 4 7 12l8 8' : 'M9 4l8 8-8 8'}" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
  return b;
}

/** The first block of the article the reader can currently see. */
function firstVisible(src: HTMLElement): Element | null {
  for (const b of src.querySelectorAll(BLOCKS)) {
    const r = b.getBoundingClientRect();
    if (r.height > 0 && r.bottom > 90) return r.top < window.innerHeight ? b : null;
  }
  return null;
}

/* ------------------------------------------------------------------ wiring */

function bind() {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-book-reader]')) {
    btn.hidden = false;
    if (btn.dataset.bound) continue;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      if (reader) return;
      const source = btn.closest<HTMLElement>('[data-book-source]') ?? document.querySelector<HTMLElement>('[data-book-source]');
      if (!source) return;
      reader = new Reader(source, btn, btn.dataset.head ?? '', btn.dataset.title ?? document.title, (btn.dataset.mode as Mode) ?? 'flow');
      reader.open();
    });
  }
}

document.addEventListener('astro:page-load', bind);
document.addEventListener('astro:before-swap', () => {
  if (!reader) return;
  reader.finishTurn();
  reader.root.remove();
  document.documentElement.classList.remove('br-is-open');
  reader = null;
});
