import facts from '../data/facts.json' with { type: 'json' };

/**
 * Numbers about work that lives in other repositories.
 *
 * Everything else on this site is counted from the site: the proposition count
 * is `getPropositionContexts().length`, the paper count is the length of a
 * collection. Those cannot go stale, because the thing being counted and the
 * count are the same object.
 *
 * ResearchLens is not on this site. Its corpus size and its test count were
 * therefore typed in by hand, and both went wrong in exactly the way typed
 * numbers do: the passage count said 9,540 while the page's own findings
 * section said 9,593, and the frontispiece advertised 194 tests when there
 * were 293. Nobody noticed either, because nothing on the site disagreed with
 * itself loudly enough to be seen.
 *
 * So they live in one file, are written by a script that goes and measures
 * them (`npm run facts`), and are read from here everywhere they appear. That
 * does not make them true forever — nothing can, from this repository — but it
 * makes them wrong in one place at a time rather than four, and correctable by
 * running a command rather than by remembering where they all were.
 */
export const FACTS = facts;

/** How many papers ResearchLens has indexed, including the added library. */
export const RESEARCHLENS = facts.researchlens;
export const LOCALSCHOLAR = facts.localscholar;

/**
 * Substitute `{fact}` tokens in prose.
 *
 * The summaries are written in the CMS as sentences — "a research assistant
 * over 101 indexed papers" — and a sentence is the right shape for them. But a
 * number inside a sentence is the least visible place for one to rot, so the
 * sentence names the fact and this fills it in.
 *
 * An unknown token is left exactly as written rather than blanked. A visible
 * `{papers}` in a paragraph is a bug anyone can see and report; a silently
 * empty gap reads as a typo in the prose, and the sentence still parses.
 */
/** @type {Record<string, number>} */
const TOKENS = {
  papers: facts.researchlens.papers,
  passages: facts.researchlens.passages,
  tests: facts.researchlens.tests,
  'localscholar.tests': facts.localscholar.tests,
};

/** @param {string} text */
export function fillFacts(text) {
  return text.replace(/\{([a-z.]+)\}/g, (whole, key) => {
    const value = TOKENS[key];
    return value === undefined ? whole : value.toLocaleString('en');
  });
}

/** The keys a page or a check may refer to, for error messages. */
export const FACT_KEYS = Object.keys(TOKENS);
