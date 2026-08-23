/**
 * The parts of the Elementa specification that both the schemas and the build
 * guards have to agree on. Kept in one module so a tier rule cannot be relaxed
 * in the guard while the schema still believes the old number.
 *
 * Reference: Elementa Master Authoring & Build Specification v2, §5 and §12.
 */

/** §5.1 — how much mathematical load a chapter carries. */
export const MATH_TIERS = ['M0', 'M1', 'M2', 'M3'] as const;
export type MathTier = (typeof MATH_TIERS)[number];

export const TIER_LABEL: Record<MathTier, string> = {
  M0: 'Narrative',
  M1: 'Definitional',
  M2: 'Substantive',
  M3: 'Load-bearing',
};

export const TIER_NOTE: Record<MathTier, string> = {
  M0: 'No mathematical load. Notation may appear; nothing is derived.',
  M1: 'Mathematics defines, and stops there. At most three displayed equations, no derivations.',
  M2: 'The derivations are the chapter. A reader who skips the algebra has not learned it.',
  M3: 'The content is mathematics. Understanding is demonstrated by computation, not recall.',
};

/** §5.3 — the nine problem variants. Do not add a tenth. */
export const VARIANTS = [
  'numeric', 'symbolic', 'shape', 'gradient', 'limit',
  'counterexample', 'complexity', 'probability', 'proof',
] as const;
export type Variant = (typeof VARIANTS)[number];

export const VARIANT_LABEL: Record<Variant, string> = {
  numeric: 'Numerical instantiation',
  symbolic: 'Symbolic derivation',
  shape: 'Dimensional algebra',
  gradient: 'Differentiation',
  limit: 'Limiting case',
  counterexample: 'Constructed failure',
  complexity: 'Cost accounting',
  probability: 'Probabilistic',
  proof: 'Proof or impossibility',
};

/** What the reader actually does. Shown beside a problem so the tag teaches. */
export const VARIANT_DOES: Record<Variant, string> = {
  numeric: 'Compute the mechanism end to end on tiny inputs, by hand.',
  symbolic: 'Derive a closed form from the definitions.',
  shape: 'Track tensor shapes through a pipeline and find the error.',
  gradient: 'Compute a derivative, Jacobian or backward rule by hand.',
  limit: 'Analyse the behaviour as a parameter goes to 0, 1 or ∞.',
  counterexample: 'Build an input on which the claim breaks.',
  complexity: 'Account for FLOPs, memory, parameters, arithmetic intensity.',
  probability: 'Work with an expectation, a variance, an estimator or a likelihood.',
  proof: 'Establish a short result, or show something cannot be done.',
};

/** §5.2 — the Math Mandate. These numbers are the whole point of v2. */
export const TIER_RULES = {
  M0: { minProblems: 0, minVariants: 0, minExercises: 0 },
  M1: { minProblems: 1, minVariants: 1, minExercises: 3 },
  M2: { minProblems: 3, minVariants: 3, minExercises: 6 },
  M3: { minProblems: 5, minVariants: 4, minExercises: 10 },
} as const satisfies Record<MathTier, { minProblems: number; minVariants: number; minExercises: number }>;

/**
 * §5.2 — an M3 chapter must hold at least one problem from each group. This is
 * what stops five numeric problems from passing as coverage.
 */
export const M3_REQUIRED_GROUPS: readonly (readonly Variant[])[] = [
  ['numeric'],
  ['symbolic'],
  ['limit', 'counterexample'],
  ['complexity', 'shape'],
];

/** §5.4 — difficulty, drawn as filled and hollow triangles. */
export const DIFFICULTY_MARK = ['▲△△', '▲▲△', '▲▲▲'] as const;
export const DIFFICULTY_LABEL = ['mechanical', 'composite', 'research-adjacent'] as const;

/** §9 — the eight figure types. */
export const FIGURE_TYPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type FigureType = (typeof FIGURE_TYPES)[number];

export const FIGURE_TYPE_LABEL: Record<FigureType, string> = {
  A: 'Definition', B: 'Construction', C: 'Flow', D: 'Comparison',
  E: 'Architecture', F: 'Equation', G: 'Failure', H: 'Research map',
};

/** §16 — Book 0. Seven parts, fixed. */
export const APPARATUS_PARTS = [
  { code: 'LA', slug: 'linear-algebra', title: 'Linear Algebra',
    covers: 'vectors, matrices, rank, eigen, SVD, norms, projections, the layout convention' },
  { code: 'MC', slug: 'matrix-calculus', title: 'Matrix Calculus',
    covers: 'gradients, Jacobians, the chain rule, the identity table, numerator layout' },
  { code: 'PR', slug: 'probability', title: 'Probability',
    covers: 'distributions, expectation, variance, Bayes, conditional independence' },
  { code: 'IT', slug: 'information-theory', title: 'Information Theory',
    covers: 'entropy, cross-entropy, KL, mutual information, Jensen’s inequality' },
  { code: 'OP', slug: 'optimisation', title: 'Optimisation',
    covers: 'convexity, gradient descent, momentum, Lagrange multipliers, KKT' },
  { code: 'ST', slug: 'statistics', title: 'Statistics',
    covers: 'estimators, bias and variance, confidence intervals, tests, the bootstrap' },
  { code: 'NU', slug: 'numerics', title: 'Numerics',
    covers: 'floating point, conditioning, stability, log-sum-exp, cancellation' },
] as const;

export const APPARATUS_CODES = APPARATUS_PARTS.map((p) => p.code);
export type ApparatusCode = (typeof APPARATUS_PARTS)[number]['code'];

export const apparatusPart = (code: string) =>
  APPARATUS_PARTS.find((p) => p.code === code);

/**
 * §10 — phrases that hide a missing step or inflate a claim. Linted, because
 * every one of them is a place a reader would have stopped and asked why.
 */
export const FORBIDDEN_PHRASES = [
  'it can be shown', 'it is easy to see', 'clearly,', 'obviously,',
  'after some algebra', 'trivially', 'simply put', 'in a nutshell',
  'game-changing', 'revolutionary', 'delve', 'cutting-edge',
  'seamless', 'harness the', 'unlock the',
] as const;

/** §0 — British spelling is a rule, not a habit. Left is wrong, right is right. */
export const SPELLING = [
  ['normalization', 'normalisation'], ['normalize', 'normalise'],
  ['tokenization', 'tokenisation'], ['tokenize', 'tokenise'],
  ['optimization', 'optimisation'], ['optimize', 'optimise'],
  ['regularization', 'regularisation'], ['regularize', 'regularise'],
  ['behavior', 'behaviour'], ['color', 'colour'], ['neighbor', 'neighbour'],
  ['generalization', 'generalisation'], ['generalize', 'generalise'],
  ['parameterization', 'parameterisation'], ['initialization', 'initialisation'],
  ['visualization', 'visualisation'], ['factorization', 'factorisation'],
  ['randomization', 'randomisation'], ['marginalization', 'marginalisation'],
] as const;

/** Books are Roman; everything below them is Arabic (§3.1). */
export const BOOK_NUMERALS = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

/** `I.5.P04` from `I.5` and 4. Proposition IDs are derived, never typed. */
export const propositionId = (chapterId: string, n: number): string =>
  `${chapterId}.P${String(n).padStart(2, '0')}`;

export const tierRule = (t: MathTier) => TIER_RULES[t];
