/**
 * motion.ts — the runtime behind motion.css.
 *
 * Contract: if the user prefers reduced motion, the general effects stay
 * detached and CSS leaves every element in its final state. Figure controls
 * still bind, so a reader can explicitly play one of the explanatory loops.
 *
 * Re-runs on `astro:page-load` so it survives view transitions.
 */

const REVEAL_SELECTOR = [
  '[data-reveal]',
  '[data-reveal-stagger]',
  '[data-press]',
  '.fig-draw',
  '.lesion-rule',
  '.plate-art',
].join(', ');

type Cleanup = () => void;
let cleanups: Cleanup[] = [];

function teardown(): void {
  for (const fn of cleanups) fn();
  cleanups = [];
}

/* ---- Explanatory figure play / pause ---------------------------------- */

const FIGURE_SELECTOR = '[data-motion-figure]';
const FIGURE_MOTION_KEY = 'codex-figure-motion';

type FigureMotionChoice = 'on' | 'off' | null;

function readFigureMotionChoice(): FigureMotionChoice {
  try {
    /* A figure-level override lasts across soft navigation and reloads in this
       tab, but not forever. A past Play click must not silently overrule a
       reduced-motion setting in a later browsing session. */
    const value = sessionStorage.getItem(FIGURE_MOTION_KEY);
    return value === 'on' || value === 'off' ? value : null;
  } catch {
    return null;
  }
}

function writeFigureMotionChoice(choice: Exclude<FigureMotionChoice, null>): void {
  try {
    sessionStorage.setItem(FIGURE_MOTION_KEY, choice);
  } catch {
    /* Private mode: keep the choice for this page load only. */
  }
}

/**
 * Cancel the figure loops for one rendered frame. Removing the class creates
 * fresh CSS animations, so the reader sees their beginning instead of an
 * arbitrary quiet phase left over from document load or a frozen tab.
 */
function restartFigureLoops(figure: HTMLElement): void {
  if (figure.dataset.motion !== 'running') return;
  figure.classList.add('is-motion-restarting');
  void figure.offsetWidth;
  requestAnimationFrame(() => figure.classList.remove('is-motion-restarting'));
}

function syncFigureMotion(playing: boolean, restart = false): void {
  const figures = Array.from(document.querySelectorAll<HTMLElement>(FIGURE_SELECTOR));
  for (const figure of figures) {
    figure.dataset.motion = playing ? 'running' : 'paused';
    for (const button of figure.querySelectorAll<HTMLButtonElement>('[data-figure-motion-toggle]')) {
      const action = playing ? 'Pause animation' : 'Play animation';
      const name = button.dataset.figureMotionName ?? 'figure';
      const label = button.querySelector<HTMLElement>('[data-figure-motion-label]');
      if (label) label.textContent = action;
      button.dataset.playing = String(playing);
      button.dataset.bound = '1';
      button.setAttribute('aria-pressed', String(playing));
      button.setAttribute('aria-label', `${action} for the ${name}`);
    }
    if (playing && restart) restartFigureLoops(figure);
  }
}

function initFigureMotion(): void {
  const figures = Array.from(document.querySelectorAll<HTMLElement>(FIGURE_SELECTOR));
  if (figures.length === 0) return;

  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const explicit = readFigureMotionChoice();
  let playing = explicit === 'on' || (explicit === null && !media.matches);
  syncFigureMotion(playing);

  const onClick = (event: Event): void => {
    const button = event.currentTarget as HTMLButtonElement;
    playing = button.closest<HTMLElement>(FIGURE_SELECTOR)?.dataset.motion !== 'running';
    writeFigureMotionChoice(playing ? 'on' : 'off');
    syncFigureMotion(playing, playing);
  };

  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-figure-motion-toggle]'));
  for (const button of buttons) button.addEventListener('click', onClick);

  /* Reset once the illustration itself—not merely the document—becomes
     visible, and pause it again when it leaves. Elementa contains many SVG
     packets; there is no reason to keep painting them below the fold. The
     loops remain unconditional CSS, so observer failure cannot freeze them. */
  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const figure = entry.target as HTMLElement;
          figure.dataset.motionVisible = String(entry.isIntersecting);
          if (entry.isIntersecting) restartFigureLoops(figure);
        }
      },
      { threshold: 0.2 }
    );
    for (const figure of figures) observer.observe(figure);
  } else {
    for (const figure of figures) {
      figure.dataset.motionVisible = 'true';
      restartFigureLoops(figure);
    }
  }

  const restartVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    for (const figure of figures) {
      const rect = figure.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < window.innerHeight) {
        figure.dataset.motionVisible = 'true';
        restartFigureLoops(figure);
      }
    }
  };
  const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) restartVisible();
  };
  const onVisibility = (): void => restartVisible();
  const onPreference = (): void => {
    if (readFigureMotionChoice() !== null) return;
    playing = !media.matches;
    syncFigureMotion(playing, playing);
  };

  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('resume', onVisibility);
  media.addEventListener?.('change', onPreference);

  cleanups.push(() => {
    observer?.disconnect();
    for (const figure of figures) delete figure.dataset.motionVisible;
    for (const button of buttons) button.removeEventListener('click', onClick);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('resume', onVisibility);
    media.removeEventListener?.('change', onPreference);
  });
}

/* ---- One-shot reveal observer ---- */
function revealAll(): void {
  for (const el of document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR)) {
    el.classList.add('is-revealed');
  }
}

function initReveals(): void {
  const targets = Array.from(document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
  if (targets.length === 0) return;

  // No observer support: show everything rather than hide it.
  if (typeof IntersectionObserver === 'undefined') {
    revealAll();
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        io.unobserve(entry.target); // one-shot
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
  );

  for (const el of targets) {
    // Anything already above the fold reveals immediately, so the first
    // paint is never a blank page.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
      el.classList.add('is-revealed');
    } else {
      io.observe(el);
    }
  }
  cleanups.push(() => io.disconnect());
}

/* ---- Give every drawable path its own length ---- */
function initDrawLengths(): void {
  const paths = document.querySelectorAll<SVGGeometryElement>('.fig-draw [data-draw]');
  for (const p of paths) {
    if (typeof p.getTotalLength !== 'function') continue;
    const len = Math.ceil(p.getTotalLength());
    if (len > 0) p.style.setProperty('--len', String(len));
  }
}

/* ---- Plain figures: stop the loops that are nowhere near the reader ---- */

/**
 * The bespoke plates carry their own wrapper and their own pause rules. The
 * ordinary illustrations — the `.fig` SVGs that fill the chapters — carried
 * neither, so their loops ran for the life of the page however far off screen
 * they were. The gallery page alone holds seventy-nine of them.
 *
 * Only 'false' is ever written. A figure this never reaches keeps animating,
 * which is the right way round for a switch that might not be wired up.
 */
function initPlainFigures(): void {
  if (typeof IntersectionObserver === 'undefined') return;
  const figs = Array.from(document.querySelectorAll<SVGElement>('svg.fig'));
  if (figs.length === 0) return;

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const fig = entry.target as SVGElement;
        if (entry.isIntersecting) fig.removeAttribute('data-motion-visible');
        else fig.setAttribute('data-motion-visible', 'false');
      }
    },
    /* A screen's margin either side, so a figure is already running by the
       time it is scrolled to rather than starting under the reader's eye. */
    { rootMargin: '100% 0px' }
  );
  for (const fig of figs) io.observe(fig);

  cleanups.push(() => {
    io.disconnect();
    for (const fig of figs) fig.removeAttribute('data-motion-visible');
  });
}

/* ---- Parallax ---- */
function initParallax(): void {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-parallax]'));
  if (items.length === 0) return;

  let ticking = false;
  const update = (): void => {
    ticking = false;
    const vh = window.innerHeight;
    for (const el of items) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > vh + 200) continue;
      const depth = Number(el.dataset.parallax ?? '0.12');
      // -1 at the top of the viewport, +1 at the bottom
      const progress = (rect.top + rect.height / 2 - vh / 2) / (vh / 2);
      el.style.setProperty('--py', `${(-progress * depth * 100).toFixed(2)}px`);
    }
  };
  const onScroll = (): void => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  cleanups.push(() => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  });
}

/* ---- Cursor lens ---- */
function initCursor(): void {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const lens = document.querySelector<HTMLElement>('.cursor-lens');
  if (!lens) return;

  let tx = window.innerWidth / 2;
  let ty = window.innerHeight / 2;
  let cx = tx;
  let cy = ty;
  let raf = 0;
  let live = false;

  const write = (): void => {
    lens.style.setProperty('--cx', `${cx.toFixed(1)}px`);
    lens.style.setProperty('--cy', `${cy.toFixed(1)}px`);
  };

  /**
   * The easing runs only while there is ground left to cover.
   *
   * This loop used to re-schedule itself unconditionally, which meant every
   * desktop visit held a 60fps timer open for the life of the page: two custom
   * properties written per frame, on an element that blends with its backdrop,
   * whether or not the pointer had ever moved. It now settles and stops, and
   * the next movement wakes it.
   */
  const step = (): void => {
    raf = 0;
    const dx = tx - cx;
    const dy = ty - cy;
    // Below a tenth of a pixel the rounding in write() produces the same
    // string, so there is nothing left to say: land on the target and stop.
    if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
      cx = tx;
      cy = ty;
      write();
      return;
    }
    cx += dx * 0.18;
    cy += dy * 0.18;
    write();
    raf = requestAnimationFrame(step);
  };

  const wake = (): void => {
    if (raf === 0) raf = requestAnimationFrame(step);
  };

  /* The hover test walks up the tree, so it is worth doing once per element
     entered rather than once per pixel travelled across it. */
  let lastTarget: Element | null = null;

  const onMove = (e: PointerEvent): void => {
    tx = e.clientX;
    ty = e.clientY;
    if (!live) {
      live = true;
      lens.classList.add('is-live');
    }
    const target = e.target as Element | null;
    if (target !== lastTarget) {
      lastTarget = target;
      const interactive = target?.closest('a, button, [data-tilt], summary, input, label');
      lens.classList.toggle('is-over', Boolean(interactive));
    }
    wake();
  };
  const onLeave = (): void => {
    live = false;
    lastTarget = null;
    lens.classList.remove('is-live');
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  write();

  cleanups.push(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerleave', onLeave);
    lens.classList.remove('is-live', 'is-over');
  });
}

/**
 * A pointer handler that reads the element's box without paying for it twice.
 *
 * A pointermove handler that calls getBoundingClientRect() forces the browser
 * to finish layout before it can answer — once per event, and a 1000Hz mouse
 * sends far more events than there are frames to draw. This measures once on
 * entry, re-measures only when scrolling or resizing can have moved the box,
 * and does its writing inside a frame, so a burst of events costs one update.
 */
function onPointerWithin(
  el: HTMLElement,
  paint: (rect: DOMRect, x: number, y: number) => void,
  leave: () => void
): void {
  let rect: DOMRect | null = null;
  let point: { x: number; y: number } | null = null;
  let raf = 0;

  const stale = (): void => { rect = null; };

  const frame = (): void => {
    raf = 0;
    if (!point) return;
    if (!rect) rect = el.getBoundingClientRect();
    paint(rect, point.x, point.y);
  };

  const onEnter = (e: PointerEvent): void => {
    rect = el.getBoundingClientRect();
    point = { x: e.clientX, y: e.clientY };
    if (raf === 0) raf = requestAnimationFrame(frame);
  };
  const onMove = (e: PointerEvent): void => {
    point = { x: e.clientX, y: e.clientY };
    if (raf === 0) raf = requestAnimationFrame(frame);
  };
  const onLeave = (): void => {
    if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
    point = null;
    rect = null;
    leave();
  };

  el.addEventListener('pointerenter', onEnter, { passive: true });
  el.addEventListener('pointermove', onMove, { passive: true });
  el.addEventListener('pointerleave', onLeave, { passive: true });
  window.addEventListener('scroll', stale, { passive: true });
  window.addEventListener('resize', stale, { passive: true });

  cleanups.push(() => {
    if (raf !== 0) cancelAnimationFrame(raf);
    el.removeEventListener('pointerenter', onEnter);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('scroll', stale);
    window.removeEventListener('resize', stale);
    leave();
  });
}

/* ---- 3D tilt ---- */
function initTilt(): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-tilt]'));
  if (cards.length === 0) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const MAX = 7; // degrees

  for (const card of cards) {
    onPointerWithin(
      card,
      (r, x, y) => {
        const px = (x - r.left) / r.width - 0.5;
        const py = (y - r.top) / r.height - 0.5;
        card.style.transform =
          `perspective(900px) rotateX(${(-py * MAX).toFixed(2)}deg) ` +
          `rotateY(${(px * MAX).toFixed(2)}deg) translate3d(0,-3px,0)`;
      },
      () => { card.style.transform = ''; }
    );
  }
}

/* ---- Magnetic pull ---- */
function initMagnets(): void {
  const magnets = Array.from(document.querySelectorAll<HTMLElement>('[data-magnet]'));
  if (magnets.length === 0) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  for (const el of magnets) {
    onPointerWithin(
      el,
      (r, x, y) => {
        const dx = x - (r.left + r.width / 2);
        const dy = y - (r.top + r.height / 2);
        el.classList.add('is-pulled');
        el.style.setProperty('--mx', `${(dx * 0.18).toFixed(1)}px`);
        el.style.setProperty('--my', `${(dy * 0.24).toFixed(1)}px`);
      },
      () => {
        el.classList.remove('is-pulled');
        el.style.setProperty('--mx', '0px');
        el.style.setProperty('--my', '0px');
      }
    );
  }
}

function boot(): void {
  teardown();
  initFigureMotion();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    revealAll();
    return;
  }
  initDrawLengths();
  initReveals();
  initPlainFigures();
  initParallax();
  initCursor();
  initTilt();
  initMagnets();
}

document.addEventListener('astro:page-load', boot);
document.addEventListener('astro:before-swap', teardown);
if (document.readyState !== 'loading') boot();
else document.addEventListener('DOMContentLoaded', boot);
