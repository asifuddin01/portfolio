/**
 * The Elementa plate: a small network, its forward pass, and its gradients.
 *
 * Same rule as the frontispiece's descent plate — nothing is illustrated.
 * The weights come from a seeded generator, the activations are what this
 * network actually computes for a fixed input, and the edge gradients are what
 * backpropagation actually returns for a fixed target. All at build time, so
 * the page ships finished numbers and the animation costs no scripting.
 *
 * It earns its place on this page specifically: Book I is the perceptron,
 * backpropagation and optimisation, and the animation is a forward pass
 * followed by the backward one. The picture is the subject of the book.
 */

/** Deterministic weights. A build must produce the same plate every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tanh = Math.tanh;
/** d/dx tanh(x), written in terms of the output because that is what we keep. */
const dtanh = (y: number) => 1 - y * y;

export type Edge = {
  from: number;   // node index within the previous layer
  to: number;     // node index within this layer
  w: number;      // the weight
  g: number;      // dLoss/dw, from one backward pass
};

export type Layer = {
  /** Activations, one per node, in [-1, 1]. */
  a: number[];
  /** Incoming edges. Empty for the input layer. */
  edges: Edge[];
};

/** 4 → 6 → 6 → 3. Wide enough to read as a network, small enough to draw. */
const SHAPE = [4, 6, 6, 3];

/**
 * One network, one forward pass, one backward pass.
 *
 * Xavier-ish initialisation, tanh activations, and a squared-error loss
 * against a fixed target. None of that is a claim about good practice — it is
 * the smallest arrangement whose gradients are non-degenerate, so the backward
 * wave has something real to carry.
 */
export function build(seed = 7): Layer[] {
  const rnd = mulberry32(seed);
  const gauss = () => (rnd() * 2 - 1) * 1.2;

  // ---- weights -------------------------------------------------------
  const W: number[][][] = [];
  for (let l = 1; l < SHAPE.length; l++) {
    const scale = Math.sqrt(1 / SHAPE[l - 1]);
    W.push(
      Array.from({ length: SHAPE[l] }, () =>
        Array.from({ length: SHAPE[l - 1] }, () => gauss() * scale * 2.2)
      )
    );
  }

  // ---- forward -------------------------------------------------------
  // A fixed input, so the plate is the same on every build.
  const A: number[][] = [[0.9, -0.4, 0.65, -0.85]];
  for (let l = 0; l < W.length; l++) {
    const prev = A[l];
    A.push(W[l].map((row) => tanh(row.reduce((s, w, j) => s + w * prev[j], 0))));
  }

  // ---- backward ------------------------------------------------------
  // Squared error against a fixed target. delta[l] is dLoss/dz for layer l+1.
  const TARGET = [0.8, -0.6, 0.25];
  const out = A[A.length - 1];
  let delta = out.map((o, i) => (o - TARGET[i]) * dtanh(o));

  const G: number[][][] = new Array(W.length);
  for (let l = W.length - 1; l >= 0; l--) {
    const prev = A[l];
    G[l] = delta.map((d) => prev.map((p) => d * p));
    if (l > 0) {
      const back = prev.map((p, j) =>
        delta.reduce((s, d, i) => s + d * W[l][i][j], 0) * dtanh(p)
      );
      delta = back;
    }
  }

  // ---- assemble ------------------------------------------------------
  return SHAPE.map((_, l) => ({
    a: A[l],
    edges:
      l === 0
        ? []
        : W[l - 1].flatMap((row, to) =>
            row.map((w, from) => ({ from, to, w, g: G[l - 1][to][from] }))
          ),
  }));
}

/** Largest |weight| across the network, for scaling stroke widths. */
export const maxAbs = (layers: Layer[], key: 'w' | 'g'): number =>
  Math.max(...layers.flatMap((l) => l.edges.map((e) => Math.abs(e[key]))), 1e-9);
