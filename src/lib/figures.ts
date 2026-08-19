import FigPipelineHierarchiRetina from '../components/figures/FigPipelineHierarchiRetina.astro';
import FigTokenBoundary from '../components/figures/FigTokenBoundary.astro';
import FigAttentionWeights from '../components/figures/FigAttentionWeights.astro';
import FigPermutation from '../components/figures/FigPermutation.astro';

/**
 * The figure library. Figures are the shareable unit of technical writing,
 * so each one gets a permalink on /elementa/figures.
 */
export const FIGURES = {
  FigPipelineHierarchiRetina: {
    component: FigPipelineHierarchiRetina,
    caption:
      'The HierarchiRetina three-stage pipeline: screening, five parallel lesion segmenters, and lesion-guided grading over eight channels.',
    source: 'Plate I — HierarchiRetina',
  },
  FigTokenBoundary: {
    component: FigTokenBoundary,
    caption:
      'One string under three tokenisations. The segmentation chosen at the input fixes which distinctions the model is able to represent at all.',
    source: 'Book I, Proposition 1',
  },
  FigAttentionWeights: {
    component: FigAttentionWeights,
    caption:
      'Attention as a weighted average over values, with weights computed by comparing a query against every key. Nothing in the computation depends on position.',
    source: 'Book I, Proposition 4',
  },
  FigPermutation: {
    component: FigPermutation,
    caption:
      'Permutation equivariance and its repair. Without positional encoding a reordered input yields a merely reordered output; with it, order becomes information.',
    source: 'Book I, Proposition 7',
  },
} as const;

export type FigureName = keyof typeof FIGURES;

export function isFigureName(name: string): name is FigureName {
  return Object.prototype.hasOwnProperty.call(FIGURES, name);
}
