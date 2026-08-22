import FigPipelineHierarchiRetina from '../components/figures/FigPipelineHierarchiRetina.astro';
/* Book I, Chapter I — Computation and Representation */
import FigModelAsFunction from '../components/figures/FigModelAsFunction.astro';
import FigTensorShape from '../components/figures/FigTensorShape.astro';
import FigParameterSpace from '../components/figures/FigParameterSpace.astro';
import FigLossLandscape from '../components/figures/FigLossLandscape.astro';
import FigGeneralisation from '../components/figures/FigGeneralisation.astro';
/* Book I, Chapter II — Neural Networks */
import FigNeuron from '../components/figures/FigNeuron.astro';
import FigDepthFolds from '../components/figures/FigDepthFolds.astro';
import FigComputationalGraph from '../components/figures/FigComputationalGraph.astro';
import FigDescentStep from '../components/figures/FigDescentStep.astro';
import FigRegularisation from '../components/figures/FigRegularisation.astro';
/* Book I, Chapter III — Tokenisation and Embeddings */
import FigTokenBoundary from '../components/figures/FigTokenBoundary.astro';
import FigBPEMerge from '../components/figures/FigBPEMerge.astro';
import FigEmbeddingSpace from '../components/figures/FigEmbeddingSpace.astro';
import FigContextualisation from '../components/figures/FigContextualisation.astro';
/* Book I, Chapter IV — Sequence Representation */
import FigRecurrentState from '../components/figures/FigRecurrentState.astro';
import FigVanishingGradient from '../components/figures/FigVanishingGradient.astro';
import FigGating from '../components/figures/FigGating.astro';
import FigDilation from '../components/figures/FigDilation.astro';
import FigSequenceLineage from '../components/figures/FigSequenceLineage.astro';
/* Book I, Chapter V — Attention */
import FigAttentionWeights from '../components/figures/FigAttentionWeights.astro';
import FigQKV from '../components/figures/FigQKV.astro';
import FigSoftmaxTemperature from '../components/figures/FigSoftmaxTemperature.astro';
import FigSelfVsCross from '../components/figures/FigSelfVsCross.astro';
import FigAttentionCost from '../components/figures/FigAttentionCost.astro';
/* Book I, Chapter VI — Position and Order */
import FigPermutation from '../components/figures/FigPermutation.astro';
import FigSinusoid from '../components/figures/FigSinusoid.astro';
import FigRoPE from '../components/figures/FigRoPE.astro';
import FigExtrapolation from '../components/figures/FigExtrapolation.astro';
/* Book I, Chapter VII — The Transformer */
import FigTransformerBlock from '../components/figures/FigTransformerBlock.astro';
import FigMultiHead from '../components/figures/FigMultiHead.astro';
import FigResidualStream from '../components/figures/FigResidualStream.astro';
import FigPrePostNorm from '../components/figures/FigPrePostNorm.astro';
import FigCausalMask from '../components/figures/FigCausalMask.astro';
import FigEncoderDecoder from '../components/figures/FigEncoderDecoder.astro';
/* Book I, Chapter VIII — Training Deep Models */
import FigBatchNoise from '../components/figures/FigBatchNoise.astro';
import FigSchedule from '../components/figures/FigSchedule.astro';
import FigClipping from '../components/figures/FigClipping.astro';
import FigPrecision from '../components/figures/FigPrecision.astro';
import FigSplitLeak from '../components/figures/FigSplitLeak.astro';
/* Marginalia — the model reviews */
import FigGramAnchoring from '../components/figures/FigGramAnchoring.astro';
import FigFcmaeGrn from '../components/figures/FigFcmaeGrn.astro';
import FigConvHandback from '../components/figures/FigConvHandback.astro';
import FigLinearProbe from '../components/figures/FigLinearProbe.astro';
import FigFingerprint from '../components/figures/FigFingerprint.astro';
import FigScalingFlat from '../components/figures/FigScalingFlat.astro';
import FigQwenLadder from '../components/figures/FigQwenLadder.astro';
import FigOpenVsApi from '../components/figures/FigOpenVsApi.astro';
import FigPresenceToken from '../components/figures/FigPresenceToken.astro';
import FigKvCache from '../components/figures/FigKvCache.astro';
import FigPricePerTask from '../components/figures/FigPricePerTask.astro';
import FigTotalVsActive from '../components/figures/FigTotalVsActive.astro';
import FigContextClaim from '../components/figures/FigContextClaim.astro';
import FigFlopsVsLatency from '../components/figures/FigFlopsVsLatency.astro';
import FigContextResolution from '../components/figures/FigContextResolution.astro';
import FigAffinityGap from '../components/figures/FigAffinityGap.astro';
import FigDataCrossover from '../components/figures/FigDataCrossover.astro';
import FigCountLikelihood from '../components/figures/FigCountLikelihood.astro';
import FigTwoBenchmarks from '../components/figures/FigTwoBenchmarks.astro';
import FigStripedHyena from '../components/figures/FigStripedHyena.astro';
/* Book I — closing */
import FigTransformerMap from '../components/figures/FigTransformerMap.astro';

/**
 * The figure library. Figures are the shareable unit of technical writing,
 * so each one gets a permalink on /elementa/figures.
 *
 * `source` names the proposition the figure was drawn for, in Book · Chapter ·
 * Proposition form. The numbering is per chapter, so "Book I, Ch. V, Prop. 1"
 * is unambiguous where a bare proposition number would not be.
 *
 * Adding an entry here is what makes a figure selectable in /admin: the option
 * list in public/admin/config.yml is checked against these keys by
 * `npm run check:cms`, so the two cannot drift apart.
 */
export const FIGURES = {
  FigPipelineHierarchiRetina: {
    component: FigPipelineHierarchiRetina,
    caption:
      'The HierarchiRetina three-stage pipeline: screening, five parallel lesion segmenters, and lesion-guided grading over eight channels.',
    source: 'Plate I — HierarchiRetina',
  },

  FigModelAsFunction: {
    component: FigModelAsFunction,
    caption:
      'A model as a function of two arguments. The input comes from the world; the parameters are the only part training is allowed to change.',
    source: 'Book I, Ch. I, Prop. 1',
  },
  FigTensorShape: {
    component: FigTensorShape,
    caption:
      'The axes of a tensor, named. The same numbers arranged along different axes are different data, which is why a shape is a claim about meaning and not only about storage.',
    source: 'Book I, Ch. I, Prop. 2',
  },
  FigParameterSpace: {
    component: FigParameterSpace,
    caption:
      'Training as a path through parameter space. Every point on the path is the same architecture holding different numbers.',
    source: 'Book I, Ch. I, Prop. 3',
  },
  FigLossLandscape: {
    component: FigLossLandscape,
    caption:
      'A loss surface drawn as contours, with a deep basin and a shallower one. Descent finds the nearer minimum, which is not always the better one.',
    source: 'Book I, Ch. I, Prop. 4',
  },
  FigGeneralisation: {
    component: FigGeneralisation,
    caption:
      'Training error and held-out error against training time. The gap that opens after the held-out minimum is the memorised part.',
    source: 'Book I, Ch. I, Prop. 5',
  },

  FigNeuron: {
    component: FigNeuron,
    caption:
      'One unit: a weighted sum, a bias, and an activation. Everything before the activation is affine, and affine maps compose into a single affine map.',
    source: 'Book I, Ch. II, Prop. 1',
  },
  FigDepthFolds: {
    component: FigDepthFolds,
    caption:
      'Two linear layers composed give one line whatever the depth. The same two layers with a rectifier between them give a piecewise curve, one fold per unit.',
    source: 'Book I, Ch. II, Prop. 2',
  },
  FigComputationalGraph: {
    component: FigComputationalGraph,
    caption:
      'One graph traversed twice: values forwards, partial derivatives backwards. Backpropagation is the chain rule with the intermediate results kept.',
    source: 'Book I, Ch. II, Prop. 3',
  },
  FigDescentStep: {
    component: FigDescentStep,
    caption:
      'The same descent under three learning rates. Too small and it creeps, too large and it climbs the far wall; the gradient supplies the direction, never the distance.',
    source: 'Book I, Ch. II, Prop. 4',
  },
  FigRegularisation: {
    component: FigRegularisation,
    caption:
      'Seven points fitted exactly and fitted loosely. Regularisation does not improve the fit — it decides which fit you get when many are available.',
    source: 'Book I, Ch. II, Prop. 5',
  },

  FigTokenBoundary: {
    component: FigTokenBoundary,
    caption:
      'One string under three tokenisations. The segmentation chosen at the input fixes which distinctions the model is able to represent at all.',
    source: 'Book I, Ch. III, Prop. 1',
  },
  FigBPEMerge: {
    component: FigBPEMerge,
    caption:
      'Byte-pair encoding, three merges deep. The merge list is the tokeniser; it is fixed by frequency in a corpus before training begins, and nothing in it is learned by the model.',
    source: 'Book I, Ch. III, Prop. 2',
  },
  FigEmbeddingSpace: {
    component: FigEmbeddingSpace,
    caption:
      'The embedding table and the space it induces. Retrieval is indexing; the geometry among the retrieved rows is a consequence of training.',
    source: 'Book I, Ch. III, Prop. 3',
  },
  FigContextualisation: {
    component: FigContextualisation,
    caption:
      'One token in two sentences. It enters as the same vector in both, and only separates once a layer of attention has let it read its neighbours.',
    source: 'Book I, Ch. III, Prop. 4',
  },

  FigRecurrentState: {
    component: FigRecurrentState,
    caption:
      'A recurrence unrolled. Every step passes a fixed-width state to the next, so the path between two distant positions is as long as the distance between them.',
    source: 'Book I, Ch. IV, Prop. 1',
  },
  FigVanishingGradient: {
    component: FigVanishingGradient,
    caption:
      'A repeated multiplication over sixteen steps. Nothing here is peculiar to recurrence: it is what happens to any long product of numbers that are not exactly one.',
    source: 'Book I, Ch. IV, Prop. 2',
  },
  FigGating: {
    component: FigGating,
    caption:
      'A gated cell. The carry line crosses only a multiplication and an addition, so with the forget gate near one the gradient has a route home that no weight matrix attenuates.',
    source: 'Book I, Ch. IV, Prop. 3',
  },
  FigDilation: {
    component: FigDilation,
    caption:
      'Receptive field growth under stacked dilated convolutions. Range grows exponentially with depth and every position is computed at once — attention buys the same range at depth one.',
    source: 'Book I, Ch. IV, Prop. 4',
  },
  FigSequenceLineage: {
    component: FigSequenceLineage,
    caption:
      'Four ways to read a sequence, placed by path length and parallelism. Attention is not a better idea in the abstract; it is the trade that pays on parallel hardware.',
    source: 'Book I, Ch. IV, Prop. 5',
  },

  FigAttentionWeights: {
    component: FigAttentionWeights,
    caption:
      'Attention as a weighted average over values, with weights computed by comparing a query against every key. Nothing in the computation depends on position.',
    source: 'Book I, Ch. V, Prop. 1',
  },
  FigQKV: {
    component: FigQKV,
    caption:
      'Query, key and value as three learned projections of one vector: what a token is looking for, what it advertises, and what it hands over once matched.',
    source: 'Book I, Ch. V, Prop. 2',
  },
  FigSoftmaxTemperature: {
    component: FigSoftmaxTemperature,
    caption:
      'The same attention logits, scaled and unscaled. Without the divisor the distribution collapses onto one key and the gradient through the softmax goes flat.',
    source: 'Book I, Ch. V, Prop. 3',
  },
  FigSelfVsCross: {
    component: FigSelfVsCross,
    caption:
      'Self-attention and cross-attention are one operation under two wirings. Only the source of the keys and values changes.',
    source: 'Book I, Ch. V, Prop. 4',
  },
  FigAttentionCost: {
    component: FigAttentionCost,
    caption:
      'The score matrix at three sequence lengths. Constant path length between any two positions is bought with an area that grows as the square of the sequence.',
    source: 'Book I, Ch. V, Prop. 5',
  },

  FigPermutation: {
    component: FigPermutation,
    caption:
      'Permutation equivariance and its repair. Without positional encoding a reordered input yields a merely reordered output; with it, order becomes information.',
    source: 'Book I, Ch. VI, Prop. 1',
  },
  FigSinusoid: {
    component: FigSinusoid,
    caption:
      'Sinusoidal encoding as a bank of clocks. Fast dimensions separate neighbouring positions, slow ones separate distant regions, and together they give each position a signature.',
    source: 'Book I, Ch. VI, Prop. 2',
  },
  FigRoPE: {
    component: FigRoPE,
    caption:
      'Rotary encoding turns position into an angle. Both the query and the key are rotated, so the absolute indices cancel in the inner product and only the distance survives.',
    source: 'Book I, Ch. VI, Prop. 3',
  },
  FigExtrapolation: {
    component: FigExtrapolation,
    caption:
      'Past the training length a learned table has no row at all, and a periodic scheme has a value but no experience. A long-context claim is a claim about training, not about the encoding.',
    source: 'Book I, Ch. VI, Prop. 4',
  },

  FigTransformerBlock: {
    component: FigTransformerBlock,
    caption:
      'One transformer block: attention moves information between positions, the feed-forward network does the work within one, and both are wrapped in a residual addition.',
    source: 'Book I, Ch. VII, Prop. 1',
  },
  FigMultiHead: {
    component: FigMultiHead,
    caption:
      'One attention budget divided into four heads. Heads are slices rather than copies, so several relations are attended to at once at the cost of resolution inside each.',
    source: 'Book I, Ch. VII, Prop. 2',
  },
  FigResidualStream: {
    component: FigResidualStream,
    caption:
      'The residual stream. Blocks read from it and add back into it rather than replacing it, which is both why gradients reach layer one and why intermediate states can be read.',
    source: 'Book I, Ch. VII, Prop. 3',
  },
  FigPrePostNorm: {
    component: FigPrePostNorm,
    caption:
      'Post-norm puts a normalisation on the shortcut; pre-norm leaves the shortcut clean. The same two components in two orders, with different training behaviour.',
    source: 'Book I, Ch. VII, Prop. 4',
  },
  FigCausalMask: {
    component: FigCausalMask,
    caption:
      'The causal mask. Setting the future to minus infinity before the softmax is what lets every position in a sequence be trained as a separate prediction in one pass.',
    source: 'Book I, Ch. VII, Prop. 5',
  },
  FigEncoderDecoder: {
    component: FigEncoderDecoder,
    caption:
      'Encoder, decoder, and the two joined by cross-attention. Same block, same arithmetic — the masks and the wiring are the whole of the difference.',
    source: 'Book I, Ch. VII, Prop. 6',
  },

  FigBatchNoise: {
    component: FigBatchNoise,
    caption:
      'The batch gradient as an estimate of the true one. A small batch scatters widely and steps often; a large batch points true and steps rarely.',
    source: 'Book I, Ch. VIII, Prop. 1',
  },
  FigSchedule: {
    component: FigSchedule,
    caption:
      'Warm-up then decay. The rise exists because the optimiser has no statistics yet; the fall exists because a large step near the end discards what the earlier ones found.',
    source: 'Book I, Ch. VIII, Prop. 2',
  },
  FigClipping: {
    component: FigClipping,
    caption:
      'Gradient norms over fourteen steps with a clipping threshold. Clipping touches only the rare spike; weight decay pulls on every parameter every step. They guard different failures.',
    source: 'Book I, Ch. VIII, Prop. 3',
  },
  FigPrecision: {
    component: FigPrecision,
    caption:
      'Representable range in three float formats. Half precision is narrow, and late-training gradients fall through its floor — which is what loss scaling exists to prevent.',
    source: 'Book I, Ch. VIII, Prop. 4',
  },
  FigSplitLeak: {
    component: FigSplitLeak,
    caption:
      'The same six images split two ways. Splitting by image puts every patient on both sides; splitting by patient is the only one of the two that measures what the claim is about.',
    source: 'Book I, Ch. VIII, Prop. 5',
  },

  FigTransformerMap: {
    component: FigTransformerMap,
    caption:
      'The whole of Book I on one plate, from characters to logits, with the chapter covering each stage named beside it.',
    source: 'Book I — closing',
  },
  FigGramAnchoring: {
    component: FigGramAnchoring,
    caption:
      'Dense features rot as a large ViT trains, because the image-level objective wants abstraction and wins. Anchoring the patch-to-patch Gram matrix to an earlier checkpoint drags them back.',
    source: 'Marginalia II — DINOv2 and DINOv3',
  },
  FigFcmaeGrn: {
    component: FigFcmaeGrn,
    caption:
      'A kernel slides across a masked hole and leaks the answer; sparse convolution stops it, and global response normalisation stops the channels collapsing. Neither half works alone.',
    source: 'Marginalia III — ConvNeXt V2',
  },
  FigConvHandback: {
    component: FigConvHandback,
    caption:
      'One residual convolution at the head of every encoder stage. That single block is the entire contribution of the paper.',
    source: 'Marginalia IV — Swin UNETR V2',
  },
  FigLinearProbe: {
    component: FigLinearProbe,
    caption:
      'What a linear probe measures, and what does the measuring. The encoder is frozen; the classifier on top is logistic regression, and its convexity is why it can serve as a ruler at all.',
    source: 'Marginalia V — logistic regression',
  },
  FigFingerprint: {
    component: FigFingerprint,
    caption:
      'A dataset fingerprint resolved by heuristic rules into a whole pipeline under a memory budget. The architecture is not among the things being chosen.',
    source: 'Marginalia VI — nnU-Net',
  },
  FigScalingFlat: {
    component: FigScalingFlat,
    caption:
      'Doubling the parameters on a fixed dataset bought seven tenths of a point. Raising the input resolution, with no extra parameters at all, bought six.',
    source: 'Marginalia VII — EVA-CLIP',
  },
  FigQwenLadder: {
    component: FigQwenLadder,
    caption:
      'The whole ladder shipped at once, with the top rung held back. The gap between the open rungs and the closed flagship is the honest measure of the commitment.',
    source: 'Marginalia VIII — Qwen',
  },
  FigOpenVsApi: {
    component: FigOpenVsApi,
    caption:
      'The two checkpoints in one release. The headline belongs to the 2.4 trillion; the 27B is the one that fits on hardware you can buy, and it is the Apache one.',
    source: 'Marginalia IX — Qwen3.8',
  },
  FigPresenceToken: {
    component: FigPresenceToken,
    caption:
      'Whether the concept is present and where it is are different questions that used to interfere. Giving presence its own token and multiplying the scores is most of why the numbers moved.',
    source: 'Marginalia X — SAM 3',
  },
  FigKvCache: {
    component: FigKvCache,
    caption:
      'At a one-million-token context, roughly a quarter of the per-token operations and a tenth of the key-value cache. Everyone quoted the parameter count.',
    source: 'Marginalia XV — DeepSeek V4',
  },
  FigPricePerTask: {
    component: FigPricePerTask,
    caption:
      'Rate card against measured cost per task. A higher price per million tokens and a lower bill per job are not contradictory when the answers run token-efficient.',
    source: 'Marginalia XVI — Kimi K3',
  },
  FigTotalVsActive: {
    component: FigTotalVsActive,
    caption:
      'Every expert is stored; only the routed few compute. Memory tracks the big number and arithmetic tracks the small one, which is the whole reason anyone does this.',
    source: 'Marginalia XVII — Mixture of experts',
  },
  FigContextClaim: {
    component: FigContextClaim,
    caption:
      'Comprehension at 120K tokens against an advertised ten-million-token window. Retrieval across a context is not comprehension of it.',
    source: 'Marginalia XVIII — Llama 4',
  },
  FigFlopsVsLatency: {
    component: FigFlopsVsLatency,
    caption:
      'Two models at the same accuracy: one with 1.8x fewer operations and 2.7x more wall-clock time. Accelerators are bound by memory bandwidth, not arithmetic.',
    source: 'Marginalia XX — EfficientNet',
  },
  FigContextResolution: {
    component: FigContextResolution,
    caption:
      'Context against output resolution. Every earlier model sits on one edge or the other; the claim is that the corner between them was an engineering limit rather than a law.',
    source: 'Marginalia XXII — AlphaGenome',
  },
  FigAffinityGap: {
    component: FigAffinityGap,
    caption:
      'Co-folding says whether two molecules fit, free energy perturbation says how tightly and runs slowly. Reaching the second at the speed of the first is what changes screening.',
    source: 'Marginalia XXIII — Boltz-2',
  },
  FigDataCrossover: {
    component: FigDataCrossover,
    caption:
      'Accuracy against pretraining set size. The paper\'s finding is a crossover with a threshold in it, somewhere near a hundred million images — not a verdict.',
    source: 'Marginalia XXIV — ViT',
  },
  FigCountLikelihood: {
    component: FigCountLikelihood,
    caption:
      'Three departures from a textbook autoencoder, each one a fact about the assay: a count likelihood, batch as a conditioning variable, and library size given its own latent.',
    source: 'Marginalia XXV — scVI',
  },
  FigTwoBenchmarks: {
    component: FigTwoBenchmarks,
    caption:
      'Two credible evaluations pointing opposite ways, and the four ordinary differences that account for it. Neither claim is dishonest.',
    source: 'Marginalia XXVI — STATE',
  },
  FigStripedHyena: {
    component: FigStripedHyena,
    caption:
      'Operators assigned by the range they cover, so attention is spent only on the sparse long-range relationships that need it. A megabase becomes affordable.',
    source: 'Marginalia XXVII — Evo 2',
  },
} as const;

export type FigureName = keyof typeof FIGURES;

export function isFigureName(name: string): name is FigureName {
  return Object.prototype.hasOwnProperty.call(FIGURES, name);
}
