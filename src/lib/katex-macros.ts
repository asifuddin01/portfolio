/**
 * The notation contract (spec §5.6), as KaTeX macros.
 *
 * Authors use the macros, never raw `\mathbf`. That means a global notation
 * change — bold vectors becoming arrows, say — is a one-line edit here rather
 * than a search through seven books.
 */
export const KATEX_MACROS: Record<string, string> = {
  '\\vec': '\\mathbf{#1}',
  '\\mat': '\\mathbf{#1}',
  '\\ten': '\\mathsf{#1}',
  '\\set': '\\mathcal{#1}',
  '\\rv': '\\mathrm{#1}',
  '\\E': '\\mathbb{E}',
  '\\R': '\\mathbb{R}',
  '\\Var': '\\operatorname{Var}',
  '\\Cov': '\\operatorname{Cov}',
  '\\KL': '\\operatorname{KL}',
  '\\do': '\\operatorname{do}',
  '\\indep': '\\perp\\!\\!\\!\\perp',
  '\\softmax': '\\operatorname{softmax}',
  '\\attn': '\\operatorname{Attention}',
  '\\dmodel': 'd_{\\text{model}}',
  '\\dk': 'd_{k}',
  '\\dv': 'd_{v}',
  '\\loss': '\\mathcal{L}',
  '\\entropy': '\\mathcal{H}',
};
