/**
 * The frontispiece plate, computed rather than drawn.
 *
 * Everything here runs at build time, so the page ships finished geometry and
 * pays nothing at runtime. That matters twice: the hero must not cost a
 * visitor a millisecond of scripting, and a picture of gradient descent on a
 * personal site should be gradient descent rather than an illustration of it.
 * The trajectories below are what these optimisers actually did on this
 * surface — nothing is placed by hand.
 */

/* ---- The surface ----------------------------------------------------- */

/**
 * Two basins and a gentle bowl, in the unit square.
 *
 * Non-convex on purpose, and asymmetric on purpose: one basin is deeper than
 * the other. A symmetric surface makes every optimiser look equally good,
 * which is the opposite of what this plate is for.
 */
export function loss(x: number, y: number): number {
  const deep = -1.0 * Math.exp(-(((x - 0.68) ** 2) + ((y - 0.62) ** 2)) / 0.055);
  const shallow = -0.62 * Math.exp(-(((x - 0.30) ** 2) + ((y - 0.40) ** 2)) / 0.038);
  const bowl = 0.55 * (((x - 0.5) ** 2) + ((y - 0.5) ** 2));
  // A slow ripple, so the contours are not perfect ellipses and the surface
  // reads as terrain rather than as a target.
  const ripple = 0.035 * Math.sin(6.2 * x) * Math.cos(5.4 * y);
  return deep + shallow + bowl + ripple;
}

/** Central differences. The analytic gradient is not worth maintaining here. */
function grad(x: number, y: number): [number, number] {
  const h = 1e-4;
  return [
    (loss(x + h, y) - loss(x - h, y)) / (2 * h),
    (loss(x, y + h) - loss(x, y - h)) / (2 * h),
  ];
}

/* ---- The optimisers -------------------------------------------------- */

export type Run = {
  id: string;
  label: string;
  points: [number, number][];
};

/**
 * Three optimisers from the same start.
 *
 * They are given hyperparameters that make them behave differently rather than
 * fairly, because the point of the plate is that a run is a choice with
 * consequences: plain descent falls into the first basin it meets and stops
 * there, momentum carries through it and reaches the deeper one, and a step
 * size chosen too large oscillates across the valley before it settles.
 *
 * That is the honest version of what training looks like. A single smooth
 * curve into a single minimum is a diagram of something that does not happen.
 */
function descend(
  start: [number, number],
  lr: number,
  mu: number,
  steps: number
): [number, number][] {
  let [x, y] = start;
  let [vx, vy] = [0, 0];
  const out: [number, number][] = [[x, y]];
  for (let i = 0; i < steps; i++) {
    const [gx, gy] = grad(x, y);
    vx = mu * vx - lr * gx;
    vy = mu * vy - lr * gy;
    x += vx;
    y += vy;
    // Off the surface is off the plate; stop rather than draw a line to nowhere.
    if (x < 0.02 || x > 0.98 || y < 0.02 || y > 0.98) break;
    out.push([x, y]);
    // Converged. The tolerance is loose on purpose: a tighter one leaves the
    // run circling its minimum for two hundred more steps, which draws as a
    // scribble on top of the very thing it found.
    if (Math.hypot(vx, vy) < 6e-4) break;
  }
  return out;
}

/**
 * Three runs, and the first two share a starting point.
 *
 * That is the whole argument of the plate: same surface, same start, one
 * hyperparameter different, and they do not arrive at the same answer. Plain
 * descent stops at the first basin it meets — measured, it settles at a loss
 * of -0.652 while the deeper basin is at -0.950 — and nothing in the run tells
 * it that a better minimum exists three tenths away.
 *
 * The step sizes were chosen by sweeping rather than by taste: this surface is
 * steep enough that lr 0.055 makes plain descent reverse direction on 43 of 47
 * steps, which is a real property of the optimiser and an illegible drawing.
 */
export const RUNS: Run[] = [
  // 24 steps, no direction reversals, and it stops in the shallow basin.
  { id: 'plain', label: 'plain descent', points: descend([0.13, 0.16], 0.010, 0.0, 400) },
  // The same start and step size. Momentum alone carries it through the
  // shallow basin and down into the deep one — 58 steps.
  { id: 'momentum', label: 'with momentum', points: descend([0.13, 0.16], 0.010, 0.85, 400) },
  // From the far corner, with a step large enough to overshoot: it crosses the
  // valley ten times before it settles, and still finds the deeper minimum.
  { id: 'coarse', label: 'larger step', points: descend([0.88, 0.14], 0.042, 0.55, 400) },
];

/* ---- Contours, by marching squares ----------------------------------- */

type Seg = [[number, number], [number, number]];

/** Where the level crosses the edge between two corners, by linear interpolation. */
const cut = (
  p: [number, number], q: [number, number], a: number, b: number, level: number
): [number, number] => {
  const t = Math.abs(b - a) < 1e-12 ? 0.5 : (level - a) / (b - a);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
};

/**
 * Chain the loose segments a marching-squares pass produces into polylines.
 *
 * Without this every cell contributes its own two-point path and a single
 * contour arrives as several hundred separate elements — which renders the
 * same but cannot be stroke-animated, because each fragment would draw itself
 * independently and the line would appear all at once in pieces.
 */
function chain(segs: Seg[]): [number, number][][] {
  const key = (p: [number, number]) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const open = new Map<string, Seg[]>();
  for (const s of segs) {
    for (const end of [s[0], s[1]]) {
      const k = key(end);
      (open.get(k) ?? open.set(k, []).get(k)!).push(s);
    }
  }
  const used = new Set<Seg>();
  const lines: [number, number][][] = [];

  for (const seg of segs) {
    if (used.has(seg)) continue;
    used.add(seg);
    const line = [seg[0], seg[1]];

    // Walk forward from the tail, then backward from the head.
    for (const dir of [1, -1]) {
      for (;;) {
        const tip = dir === 1 ? line[line.length - 1] : line[0];
        const next = (open.get(key(tip)) ?? []).find((c) => !used.has(c));
        if (!next) break;
        used.add(next);
        const far = key(next[0]) === key(tip) ? next[1] : next[0];
        if (dir === 1) line.push(far);
        else line.unshift(far);
      }
    }
    if (line.length > 3) lines.push(line);
  }
  return lines;
}

/** Iso-contours of `loss` at the given levels, as polylines in the unit square. */
export function contours(levels: number[], n = 46): { level: number; lines: [number, number][][] }[] {
  const g: number[][] = [];
  for (let j = 0; j <= n; j++) {
    const row: number[] = [];
    for (let i = 0; i <= n; i++) row.push(loss(i / n, j / n));
    g.push(row);
  }

  return levels.map((level) => {
    const segs: Seg[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x0 = i / n, x1 = (i + 1) / n, y0 = j / n, y1 = (j + 1) / n;
        const tl = g[j][i], tr = g[j][i + 1], br = g[j + 1][i + 1], bl = g[j + 1][i];
        // Corner above the level → set the bit. The 16 cases collapse to the
        // eight edge pairs below; the two saddles are resolved arbitrarily,
        // which at this grid size is invisible.
        const idx = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
        if (idx === 0 || idx === 15) continue;

        const top = () => cut([x0, y0], [x1, y0], tl, tr, level);
        const right = () => cut([x1, y0], [x1, y1], tr, br, level);
        const bottom = () => cut([x0, y1], [x1, y1], bl, br, level);
        const left = () => cut([x0, y0], [x0, y1], tl, bl, level);

        switch (idx) {
          case 1: case 14: segs.push([left(), bottom()]); break;
          case 2: case 13: segs.push([bottom(), right()]); break;
          case 3: case 12: segs.push([left(), right()]); break;
          case 4: case 11: segs.push([top(), right()]); break;
          case 6: case 9:  segs.push([top(), bottom()]); break;
          case 7: case 8:  segs.push([left(), top()]); break;
          case 5:  segs.push([left(), top()]); segs.push([bottom(), right()]); break;
          case 10: segs.push([left(), bottom()]); segs.push([top(), right()]); break;
        }
      }
    }
    return { level, lines: chain(segs) };
  });
}

/** Rough length of a polyline in viewBox units, for stroke-dash animation. */
export const pathLength = (pts: [number, number][], sx: number, sy: number): number => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot((pts[i][0] - pts[i - 1][0]) * sx, (pts[i][1] - pts[i - 1][1]) * sy);
  }
  return Math.ceil(d) + 4;
};
