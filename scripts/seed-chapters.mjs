/**
 * Seeds the chapter layer of Elementa from the teaching plan.
 *
 * Chapters are written as stubs: title, summary and the topics the chapter
 * will cover. That is enough for the structure to be navigable and for the
 * reader to see where a subject lives before a single proposition exists.
 *
 * Re-running overwrites the stubs, so edit propositions rather than these
 * once real content is in place.
 */
import { writeFileSync, readdirSync } from 'node:fs';

const y = (v) => JSON.stringify(v);
const books = readdirSync('src/content/books').map((f) => f.replace(/\.mdx$/, ''));
const find = (prefix) => books.find((b) => b.startsWith(prefix));

const FOUND = find('foundations');
const VISION = books.find((b) => b === 'vision');
const LLM = find('large-language');
const VLM = find('vision-language');
const CAUSAL = find('causal');
const BIO = find('bioinformatics');
const PRAC = find('practice');

for (const [name, slug] of Object.entries({ FOUND, VISION, LLM, VLM, CAUSAL, BIO, PRAC })) {
  if (!slug) throw new Error(`No book found for ${name}`);
}

const PLAN = {
  [FOUND]: [
    ['computation', 'Computation and Representation', 'What a model is, and what it is made of.', ['What is a model?', 'Parameters', 'Functions and representations', 'Tensors', 'Dimensions and shapes', 'Forward computation', 'Loss functions', 'Optimisation', 'Generalisation']],
    ['neural-networks', 'Neural Networks', 'Layers, non-linearity, and how gradients move through them.', ['Neurons', 'Linear layers', 'Activation functions', 'Multilayer perceptrons', 'Forward propagation', 'Backpropagation', 'Gradients', 'Optimisers', 'Learning rates', 'Regularisation']],
    ['tokenisation', 'Tokenisation and Embeddings', 'How text becomes numbers, and what that choice costs.', ['Text as discrete symbols', 'Characters, words and subwords', 'BPE', 'Unigram tokenisation', 'Vocabulary', 'Token IDs', 'Embeddings', 'Embedding spaces', 'Contextual representations']],
    ['sequences', 'Sequence Representation', 'What came before attention, and why it was replaced.', ['Sequences', 'RNNs', 'LSTMs', 'GRUs', 'CNNs for sequences', 'Long-range dependencies', 'Why transformers emerged']],
    ['attention', 'Attention', 'Content-addressed aggregation, in full.', ['Queries', 'Keys', 'Values', 'Similarity', 'Attention scores', 'Softmax', 'Weighted aggregation', 'Scaled dot-product attention', 'Self-attention', 'Cross-attention']],
    ['position', 'Position and Order', 'Attention has no sense of order; this is the repair.', ['Why attention loses order', 'Positional encodings', 'Sinusoidal encoding', 'Learned positions', 'Relative position', 'Rotary position embeddings', 'Position extrapolation']],
    ['transformer', 'The Transformer', 'The block, assembled.', ['Transformer block', 'Multi-head attention', 'Feed-forward network', 'Residual connections', 'Layer normalisation', 'Encoder', 'Decoder', 'Encoder-decoder models', 'Causal masking', 'Full forward pass']],
    ['training', 'Training Deep Models', 'Turning an architecture into a model that has learned something.', ['Dataset', 'Batch', 'Epoch', 'Optimisation', 'Learning-rate schedules', 'Weight decay', 'Gradient clipping', 'Mixed precision', 'Checkpoints', 'Evaluation']],
  ],
  [VISION]: [
    ['images', 'Images as Data', 'What a picture is once it is a tensor.', ['Pixels', 'Channels', 'RGB', 'Resolution', 'Normalisation', 'Convolution', 'Receptive fields']],
    ['convolution', 'Convolutional Vision', 'The architecture that made vision work.', ['Kernels', 'Convolution', 'Padding', 'Stride', 'Pooling', 'Feature maps', 'LeNet', 'AlexNet', 'VGG', 'ResNet', 'EfficientNet']],
    ['representation', 'Representation Learning', 'What a network learns before it learns your task.', ['Low-level features', 'Hierarchical features', 'Transfer learning', 'Pretrained representations', 'Self-supervised learning']],
    ['vision-transformers', 'Vision Transformers', 'Patches as tokens.', ['Image patches', 'Patch embeddings', 'Positional information', 'ViT', 'Hierarchical transformers', 'Swin Transformer']],
    ['self-supervision', 'Self-Supervised Vision', 'Learning without labels.', ['Contrastive learning', 'Positive and negative pairs', 'Augmentations', 'Siamese learning', 'Masked image modelling', 'DINO', 'DINOv2']],
    ['vision-tasks', 'Vision Tasks', 'One image, many questions.', ['Classification', 'Detection', 'Segmentation', 'Depth', 'Retrieval']],
    ['medical-vision', 'Medical and Scientific Vision', 'Where a wrong answer has consequences.', ['Medical imaging', 'CT', 'MRI', 'X-ray', 'Fundus imaging', 'Segmentation', 'Domain shift', 'Sensitivity and specificity', 'AUROC', 'Calibration']],
  ],
  [LLM]: [
    ['language-modelling', 'Language Modelling', 'Prediction as repeated conditional probability.', ['Probability', 'Conditional probability', 'Next-token prediction', 'Cross-entropy', 'Perplexity']],
    ['autoregressive', 'Autoregressive Transformers', 'Decoder-only models, and what makes them generate.', ['Causal masking', 'Decoder-only architecture', 'GPT-style models', 'Context windows', 'KV cache']],
    ['pretraining', 'Pretraining', 'What it takes to train one.', ['Corpus construction', 'Data filtering', 'Token budgets', 'Compute', 'Scaling', 'Distributed training']],
    ['scaling', 'Scaling', 'What more parameters, data and compute actually buy.', ['Parameter count', 'Data', 'Compute', 'Scaling laws', 'Compute and data trade-offs', 'Inference scaling']],
    ['alignment', 'Instruction Following', 'From a text predictor to something that answers.', ['Instruction tuning', 'Supervised fine-tuning', 'Preference optimisation', 'RLHF', 'DPO', 'Alignment']],
    ['prompting', 'Prompting and In-Context Learning', 'Learning without weight updates.', ['Zero-shot', 'Few-shot', 'Chain-of-thought', 'Structured prompting', 'Tool use', 'Reasoning prompts']],
    ['adaptation', 'Efficient Adaptation', 'Changing a model you cannot afford to retrain.', ['Fine-tuning', 'LoRA', 'QLoRA', 'Adapters', 'Quantisation', 'Pruning', 'Distillation']],
    ['failure', 'LLM Failure', 'The parts that do not work.', ['Hallucination', 'Bias', 'Context limitations', 'Reasoning failures', 'Benchmark contamination', 'Distribution shift', 'Evaluation problems']],
    ['systems', 'LLM Systems', 'A model is not yet a system.', ['RAG', 'Embeddings', 'Vector databases', 'Agents', 'Tools', 'Memory', 'Inference systems']],
  ],
  [VLM]: [
    ['multimodality', 'Why Join Vision and Language?', 'Two representation spaces, and the case for one.', ['Separate modalities', 'Representation spaces', 'Multimodality', 'Grounding']],
    ['contrastive', 'Contrastive Vision-Language Learning', 'CLIP, and the shared embedding space.', ['CLIP', 'Image encoder', 'Text encoder', 'Shared embedding space', 'Contrastive objective']],
    ['image-text-alignment', 'Image-Text Alignment', 'What it means for a picture and a sentence to agree.', ['Paired data', 'Alignment', 'Semantic similarity', 'Zero-shot classification']],
    ['generation', 'Vision-Language Generation', 'Getting a language model to look.', ['Image encoder', 'Projection layer', 'Language model', 'Cross-attention', 'Visual tokens', 'Multimodal prompting']],
    ['architectures', 'VLM Architectures', 'The families, by shape rather than by name.', ['CLIP-style encoders', 'BLIP and BLIP-2', 'LLaVA-style systems', 'Flamingo-style systems', 'Modern multimodal LLMs']],
    ['reasoning', 'Visual Reasoning', 'Where looking becomes thinking.', ['OCR', 'Grounding', 'Spatial reasoning', 'Counting', 'Chart understanding', 'Document understanding', 'Visual question answering']],
    ['evaluation', 'VLM Evaluation', 'Measuring something that can describe its own mistakes.', ['VQA', 'Captioning', 'Grounding', 'Hallucination', 'Multimodal reasoning', 'Robustness']],
  ],
  [CAUSAL]: [
    ['causality', 'Correlation and Causation', 'Why prediction is not enough.', ['Correlation', 'Causation', 'Confounding', 'Prediction versus intervention']],
    ['graphs', 'Causal Graphs', 'Drawing the assumptions you cannot test.', ['DAGs', 'Nodes', 'Edges', 'Paths', 'Ancestors', 'Descendants', 'Colliders', 'Confounders']],
    ['interventions', 'Interventions', 'The do-operator.', ['Do-operator', 'Intervention', 'Observational distribution', 'Interventional distribution']],
    ['identification', 'Identification', 'When the data can answer the question at all.', ['Backdoor criterion', 'Adjustment', 'Front-door criterion', 'Conditional independence']],
    ['counterfactuals', 'Counterfactuals', 'What would have happened instead.', ['Potential outcomes', 'Counterfactual worlds', 'Individual treatment effects', 'Causal effect']],
    ['experiments', 'Experiments', 'Randomisation, and why it works.', ['Randomisation', 'Treatment and control', 'A/B testing', 'Experimental design', 'Power', 'Bias']],
    ['observational', 'Observational Studies', 'Causal claims without an experiment.', ['Propensity scores', 'Matching', 'Inverse probability weighting', 'Regression adjustment', 'Sensitivity analysis']],
    ['causal-ml', 'Causal ML', 'Where machine learning meets the do-operator.', ['Heterogeneous treatment effects', 'Causal forests', 'Representation learning', 'Neural causal models', 'Causal discovery']],
    ['causal-ai', 'Causal Reasoning in AI', 'Where this reaches the rest of the corpus.', ['Machine learning', 'Vision', 'Language', 'Scientific discovery', 'Healthcare']],
  ],
  [BIO]: [
    ['biology', 'Biological Information', 'The substrate.', ['DNA', 'RNA', 'Proteins', 'Genes', 'Genomes', 'Cells']],
    ['biological-data', 'Biological Data', 'What a measurement of life looks like.', ['Sequencing', 'Expression', 'Single-cell data', 'Imaging', 'Spatial transcriptomics', 'Perturbation data']],
    ['gene-regulation', 'Gene Regulation', 'How a cell decides what to be.', ['Transcription', 'Regulatory networks', 'Transcription factors', 'Enhancers', 'Gene regulatory networks']],
    ['single-cell', 'Single-Cell Biology', 'One cell, one observation.', ['scRNA-seq', 'Cells as observations', 'Gene-expression matrices', 'Dimensionality reduction', 'Clustering', 'Cell types']],
    ['bio-representation', 'Representation Learning for Biology', 'Embedding a cell.', ['Embeddings', 'Autoencoders', 'Variational autoencoders', 'Transformers', 'Foundation models for biology']],
    ['perturbation', 'Perturbation', 'Changing something on purpose.', ['CRISPR', 'Perturb-seq', 'Interventions', 'Perturbation response', 'Causal interpretation']],
    ['networks', 'Biological Networks', 'Biology as a graph.', ['Graphs', 'Protein interaction networks', 'Gene regulatory networks', 'Graph neural networks']],
    ['drug-discovery', 'AI for Drug and Disease Research', 'Where the work is meant to land.', ['Molecular representation', 'Protein structure', 'Drug discovery', 'Disease modelling', 'Biomarker discovery']],
  ],
  [PRAC]: [
    ['reading-papers', 'Reading Papers', 'Extracting the claim, the method and the caveat.', ['Reading an abstract', 'Identifying the claim', 'Identifying the method', 'Understanding figures', 'Finding limitations', 'Following citations', 'Reproducing results']],
    ['problem-formulation', 'Problem Formulation', 'Turning an interest into a question.', ['Identifying a problem', 'Defining the research question', 'Hypothesis', 'Assumptions', 'Baselines', 'Evaluation']],
    ['datasets', 'Dataset Practice', 'Most of the work.', ['Dataset discovery', 'Collection', 'Cleaning', 'Annotation', 'Splitting', 'Leakage', 'Imbalance', 'Preprocessing']],
    ['experiments', 'Experimental Design', 'Making a result mean something.', ['Baseline', 'Ablation', 'Controls', 'Hyperparameters', 'Reproducibility', 'Random seeds', 'Experiment tracking']],
    ['evaluation', 'Evaluation', 'Choosing the number you will be judged on.', ['Choosing metrics', 'Classification metrics', 'Segmentation metrics', 'Generative evaluation', 'Calibration', 'Statistical significance', 'Confidence intervals']],
    ['training-systems', 'Training Systems', 'The machine underneath.', ['GPU', 'Memory', 'Batch size', 'Mixed precision', 'Distributed training', 'Checkpointing', 'Profiling', 'Inference']],
    ['debugging', 'Debugging Models', 'A decision tree for when nothing works.', ['Data', 'Labels', 'Preprocessing', 'Implementation', 'Optimisation', 'Model capacity']],
    ['reproducibility', 'Reproducibility', 'Being able to get the same answer twice.', ['Code organisation', 'Configuration', 'Environments', 'Seeds', 'Logging', 'Experiment tracking', 'Version control', 'Dataset versions', 'Model checkpoints']],
    ['communication', 'Research Communication', 'Writing it down so it survives.', ['Writing a paper', 'Making figures', 'Making presentations', 'Explaining methods', 'Writing limitations', 'Responding to reviewers']],
    ['projects', 'Research Projects', 'Complete worked projects, end to end.', ['Question', 'Literature', 'Hypothesis', 'Data', 'Baseline', 'Method', 'Experiment', 'Ablation', 'Evaluation', 'Analysis', 'Conclusion']],
  ],
};

let total = 0;
for (const [book, chapters] of Object.entries(PLAN)) {
  chapters.forEach(([slug, title, summary, topics], i) => {
    writeFileSync(
      `src/content/chapters/${book}--${slug}.mdx`,
      `---\nbook: ${book}\norder: ${i + 1}\ntitle: ${y(title)}\nsummary: ${y(summary)}\ntopics:\n${topics.map((t) => `  - ${y(t)}`).join('\n')}\nstatus: published\n---\n`
    );
    total++;
  });
  console.log(`  ${book.padEnd(26)} ${chapters.length}`);
}
console.log(`\n  ${total} chapters written`);
