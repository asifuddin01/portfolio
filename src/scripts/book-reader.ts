/**
 * The page-turning reader: a chapter laid out as a two-page spread (one page
 * on a phone) that turns with arrows, keys, a swipe or the page slider.
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
  turning: Animation[] = [];
  turnLayer: HTMLElement[] = [];
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
    bar.append(name, this.countEl, close);

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
    this.swipe(stage);
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

  goTo(p: number, animate: boolean) {
    const per = this.perView();
    const target = clamp(Math.floor(p / per) * per, 0, Math.max(0, (Math.ceil(this.pages / per) - 1) * per));
    const from = this.page;
    if (animate && target !== from && !this.still) {
      if (this.geo.spread && Math.abs(target - from) === 2) this.leaf(from, target);
      else this.slide(from, target);
    }
    this.page = target;
    this.place();
  }

  turn(dir: 1 | -1) {
    this.finishTurn();
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

  leaf(from: number, to: number) {
    const fwd = to > from;
    const under = fwd ? this.sheetFor(from, 'l', 'br-under') : this.sheetFor(from + 1, 'r', 'br-under');
    const leaf = el('div', `br-leaf br-leaf--${fwd ? 'fwd' : 'back'}`);
    const front = fwd ? this.sheetFor(from + 1, 'r', 'br-face') : this.sheetFor(from, 'l', 'br-face');
    const back = fwd ? this.sheetFor(from + 2, 'l', 'br-face') : this.sheetFor(from - 1, 'r', 'br-face');
    back.classList.add('br-face--back');
    const shadeF = el('div', 'br-shade');
    const shadeB = el('div', 'br-shade');
    front.append(shadeF);
    back.append(shadeB);
    leaf.append(front, back);
    this.book.append(under, leaf);
    this.turnLayer = [under, leaf];

    const ms = 760;
    const easing = 'cubic-bezier(0.45, 0.05, 0.3, 1)';
    const sign = fwd ? -1 : 1;
    const a = leaf.animate(
      [
        { transform: 'rotateY(0deg)' },
        { transform: `rotateY(${sign * 90}deg)`, offset: 0.5 },
        { transform: `rotateY(${sign * 180}deg)` },
      ],
      { duration: ms, easing },
    );
    const b = shadeF.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.5 }, { opacity: 0.55 }], { duration: ms, easing });
    const c = shadeB.animate([{ opacity: 0.55 }, { opacity: 0.55, offset: 0.5 }, { opacity: 0 }], { duration: ms, easing });
    this.turning = [a, b, c];
    a.finished.then(() => this.clearTurn(), () => this.clearTurn());
  }

  slide(from: number, to: number) {
    const { T, G } = this.geo;
    const a = this.flow.animate(
      [
        { transform: `translateX(${-from * (T + G)}px)`, opacity: 1 },
        { transform: `translateX(${-(from + (to - from) * 0.5) * (T + G)}px)`, opacity: 0.35, offset: 0.5 },
        { transform: `translateX(${-to * (T + G)}px)`, opacity: 1 },
      ],
      { duration: Math.abs(to - from) > this.perView() ? 260 : 380, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
    );
    this.turning = [a];
  }

  finishTurn() {
    for (const a of this.turning) { try { a.finish(); } catch { /* already done */ } }
    this.clearTurn();
  }

  clearTurn() {
    for (const n of this.turnLayer) {
      // Hand the copies back to the pool before the sheet goes.
      for (const c of n.querySelectorAll<HTMLElement>('.br-flow--copy')) {
        c.remove();
        if (this.clones.length < 3) this.clones.push(c);
      }
      n.remove();
    }
    this.turnLayer = [];
    this.turning = [];
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

  swipe(stage: HTMLElement) {
    let x0 = 0;
    let y0 = 0;
    let on = false;
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      on = true;
      x0 = e.clientX;
      y0 = e.clientY;
    });
    stage.addEventListener('pointerup', (e) => {
      if (!on) return;
      on = false;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(e.clientY - y0) * 1.4) this.turn(dx < 0 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', () => { on = false; });
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
