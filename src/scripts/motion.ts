/**
 * motion.ts — the runtime behind motion.css.
 *
 * Contract: if the user prefers reduced motion, this file attaches
 * nothing at all. No observers, no rAF loop, no listeners. The CSS
 * already leaves every element in its final, visible state.
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

  const loop = (): void => {
    cx += (tx - cx) * 0.18;
    cy += (ty - cy) * 0.18;
    lens.style.setProperty('--cx', `${cx.toFixed(1)}px`);
    lens.style.setProperty('--cy', `${cy.toFixed(1)}px`);
    raf = requestAnimationFrame(loop);
  };

  const onMove = (e: PointerEvent): void => {
    tx = e.clientX;
    ty = e.clientY;
    if (!live) {
      live = true;
      lens.classList.add('is-live');
    }
    const interactive = (e.target as Element | null)?.closest(
      'a, button, [data-tilt], summary, input, label'
    );
    lens.classList.toggle('is-over', Boolean(interactive));
  };
  const onLeave = (): void => {
    live = false;
    lens.classList.remove('is-live');
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  raf = requestAnimationFrame(loop);

  cleanups.push(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerleave', onLeave);
    lens.classList.remove('is-live', 'is-over');
  });
}

/* ---- 3D tilt ---- */
function initTilt(): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-tilt]'));
  if (cards.length === 0) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const MAX = 7; // degrees

  for (const card of cards) {
    const onMove = (e: PointerEvent): void => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform =
        `perspective(900px) rotateX(${(-py * MAX).toFixed(2)}deg) ` +
        `rotateY(${(px * MAX).toFixed(2)}deg) translate3d(0,-3px,0)`;
    };
    const onLeave = (): void => { card.style.transform = ''; };

    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', onLeave);
    cleanups.push(() => {
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerleave', onLeave);
      card.style.transform = '';
    });
  }
}

/* ---- Magnetic pull ---- */
function initMagnets(): void {
  const magnets = Array.from(document.querySelectorAll<HTMLElement>('[data-magnet]'));
  if (magnets.length === 0) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  for (const el of magnets) {
    const onMove = (e: PointerEvent): void => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      el.classList.add('is-pulled');
      el.style.setProperty('--mx', `${(dx * 0.18).toFixed(1)}px`);
      el.style.setProperty('--my', `${(dy * 0.24).toFixed(1)}px`);
    };
    const onLeave = (): void => {
      el.classList.remove('is-pulled');
      el.style.setProperty('--mx', '0px');
      el.style.setProperty('--my', '0px');
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    cleanups.push(() => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    });
  }
}

function boot(): void {
  teardown();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    revealAll();
    return;
  }
  initDrawLengths();
  initReveals();
  initParallax();
  initCursor();
  initTilt();
  initMagnets();
}

document.addEventListener('astro:page-load', boot);
document.addEventListener('astro:before-swap', teardown);
if (document.readyState !== 'loading') boot();
else document.addEventListener('DOMContentLoaded', boot);
