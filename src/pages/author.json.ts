import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { AUTHOR, SITE, ROLE } from '../consts';
import {
  getPapers, getProjects, getEducation, getMarginalia, getAxioms,
  getContact, getBooks, getChapters,
} from '../lib/collections';

/**
 * The author corpus — everything the public site says about Asif, as prose
 * documents a retrieval system can index and quote.
 *
 * Why this exists: ResearchLens answers from evidence and refuses without it,
 * which made it unable to answer the most common question a visitor actually
 * has — who wrote this, and what do they work on. Feeding it the site turns
 * that into a question it can answer the same way it answers any other: by
 * retrieving a passage and citing where the passage came from.
 *
 * Why it is generated rather than written: it is rebuilt by `astro build`, and
 * the site rebuilds on every push to main — including the commits Sveltia CMS
 * makes from /admin. Editing a project blurb or adding a paper therefore
 * updates what ResearchLens knows, with nothing to remember to sync. A
 * hand-maintained bio would be stale the first time it was not updated.
 *
 * THE RULE FOR WHAT GOES IN: if the public site already renders it, this may
 * carry it. If it does not, this must not. That keeps one boundary to reason
 * about instead of two, and it is why the checks below are phrased as
 * "the same accessor the page uses" rather than as their own filters:
 *
 *   - Drafts are excluded because getPapers/getMarginalia already exclude them
 *     in production; this file does not get its own opinion about visibility.
 *   - Embargoed plates keep their title and framing but never their metrics.
 *     The schema's superRefine already guarantees `metrics` is empty for them,
 *     so reading the field is safe — the explicit check below is a second lock
 *     on the same door, and cheap.
 *   - No phone number. It is not in the content collections and must not be
 *     added to them; the site does not publish one and neither does this.
 *
 * Anything here is world-readable. It is a convenience over public facts, not
 * a new disclosure, and it should stay that way.
 */

/** One indexable document. `text` is prose because it is quoted verbatim. */
type Doc = {
  id: string;
  kind: string;
  title: string;
  url: string;
  text: string;
  updated?: string;
};

/** Collapse whitespace so the JSON stays one clean line per field. */
const tidy = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Join the parts of a sentence, dropping the ones that are empty.
 *
 * `number` is in the signature because the call sites guard with
 * `array.length && '…'`, which yields 0 rather than false on an empty array.
 * The predicate keeps only non-empty strings, so a 0 is dropped rather than
 * printed — which is the whole point of letting it through the type.
 */
const sentence = (...parts: (string | number | null | undefined | false)[]): string =>
  parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' ');

export const GET: APIRoute = async () => {
  const raw: Doc[] = [];
  const abs = (path: string): string => new URL(path, SITE).href;
  /**
   * Titles come from frontmatter, and a long one is often wrapped across lines
   * in the YAML. A newline inside a citation label breaks the line it is
   * rendered on, so every title goes through the same collapse the text does.
   */
  const docs = {
    push(d: Doc) { raw.push({ ...d, title: tidy(d.title) }); },
  };

  const [
    papers, projects, education, marginalia, axioms, contact, books, chapters,
    works, siteText,
  ] = await Promise.all([
    getPapers(), getProjects(), getEducation(), getMarginalia(), getAxioms(),
    getContact(), getBooks(), getChapters(),
    getCollection('works'),
    getCollection('site'),
  ]);

  const site = (id: string) => siteText.find((e) => e.id === id)?.data;
  const cv = site('cv');
  const front = site('frontispiece');

  /* ---- Who he is ------------------------------------------------------ */
  docs.push({
    id: 'profile',
    kind: 'profile',
    title: `${AUTHOR} — who he is and what he works on`,
    url: SITE,
    text: tidy(sentence(
      `${AUTHOR} is a ${front?.role ?? ROLE}.`,
      `He is based in ${contact.location}.`,
      cv?.summary,
      cv?.languages && `Languages: ${cv.languages}`,
      front?.epigraph && `The line he puts at the head of his site is "${front.epigraph}".`,
      `His work can be read at ${SITE}, his code at ${contact.github}.`
    )),
  });

  /* ---- What he believes about the work -------------------------------- */
  if (axioms.length) {
    docs.push({
      id: 'axioms',
      kind: 'principles',
      title: `${AUTHOR} — the principles he works by`,
      url: abs('/#axioms'),
      text: tidy(
        `${AUTHOR} states five maxims that govern how he works. ` +
        axioms.map((a) => `"${a.data.text}" (from ${a.data.cite}).`).join(' ')
      ),
    });
  }

  /* ---- Papers --------------------------------------------------------- */
  const STATE: Record<string, string> = {
    published: 'published',
    preprint: 'a preprint',
    'under-review': 'under review',
    'in-preparation': 'in preparation',
  };
  for (const p of papers) {
    docs.push({
      id: `paper:${p.id}`,
      kind: 'paper',
      title: p.data.title,
      url: p.data.url ?? (p.data.doi ? `https://doi.org/${p.data.doi}` : abs('/papers')),
      text: tidy(sentence(
        `"${p.data.title}" is a paper by ${AUTHOR}`,
        p.data.authors.length > 1 && `with ${p.data.authors.filter((a) => !a.includes('Asif')).join(', ')}`,
        `— ${STATE[p.data.state] ?? p.data.state}`,
        p.data.venue && `at ${p.data.venue}`,
        `${p.data.year}.`,
        p.data.summary
      )),
    });
  }

  /* ---- Research plates ------------------------------------------------ */
  for (const w of works.sort((a, b) => a.data.plate - b.data.plate)) {
    const open = w.data.disclosure === 'public';
    docs.push({
      id: `work:${w.id}`,
      kind: 'research',
      title: w.data.fullTitle,
      url: abs(`/works/${w.id}`),
      text: tidy(sentence(
        `${AUTHOR}'s research project "${w.data.fullTitle}" (${w.data.subtitle}) is ${w.data.status.replace(/-/g, ' ')}, ${w.data.year}.`,
        w.data.supervisors.length && `Supervised by ${w.data.supervisors.join(' and ')}.`,
        w.data.coauthors.length && `With ${w.data.coauthors.join(', ')}.`,
        w.data.datasets.length && `Datasets: ${w.data.datasets.join(', ')}.`,
        w.data.abstract,
        // Embargoed plates carry no numbers. The schema forbids it; so does this.
        open && w.data.metrics.length
          ? `Results: ${w.data.metrics.map((m) => `${m.label} ${m.value}`).join(', ')}.`
          : !open && 'Results from this project are embargoed and are not published yet.'
      )),
    });
  }

  /* ---- Engineering ---------------------------------------------------- */
  for (const p of projects) {
    docs.push({
      id: `project:${p.id}`,
      kind: 'project',
      title: p.data.title,
      url: p.data.link ? abs(p.data.link) : abs('/#appendix'),
      text: tidy(sentence(
        `${AUTHOR} built "${p.data.title}".`,
        p.data.summary
      )),
    });
  }

  /* ---- Education ------------------------------------------------------ */
  docs.push({
    id: 'education',
    kind: 'education',
    title: `${AUTHOR} — education`,
    url: abs('/vitae'),
    text: tidy(
      `${AUTHOR}'s education. ` +
      education.map((e) => tidy(sentence(
        `${e.data.degree}, ${e.data.institution}, ${e.data.location}, ${e.data.period}.`,
        e.data.result && `Result: ${e.data.result}.`,
        e.data.detail
      ))).join(' ')
    ),
  });

  /* ---- What he is reading and reviewing ------------------------------- */
  for (const m of marginalia) {
    docs.push({
      id: `marginalia:${m.id}`,
      kind: 'review',
      title: m.data.title,
      url: abs(`/marginalia/${m.id}`),
      updated: m.data.updated.toISOString().slice(0, 10),
      text: tidy(sentence(
        `${AUTHOR} wrote a ${m.data.kind} note titled "${m.data.title}" about ${m.data.subject}.`,
        m.data.summary
      )),
    });
  }

  /* ---- The Elementa, as one document rather than hundreds -------------- */
  if (books.length) {
    const perBook = books.map((b) => {
      // `book` is a reference(), so it is { collection, id } and not the id.
      const n = chapters.filter((c) => c.data.book.id === b.id).length;
      return `${b.data.title} (${n} chapter${n === 1 ? '' : 's'})`;
    });
    docs.push({
      id: 'elementa',
      kind: 'writing',
      title: `${AUTHOR} — the Elementa, his textbook in progress`,
      url: abs('/elementa'),
      text: tidy(sentence(
        `${AUTHOR} is writing the Elementa, a textbook built from numbered propositions in the manner of Euclid,`,
        `covering ${books.length} books: ${perBook.join('; ')}.`,
        site('elementa')?.lede
      )),
    });
  }

  /* ---- How to reach him ----------------------------------------------- */
  docs.push({
    id: 'contact',
    kind: 'contact',
    title: `${AUTHOR} — contact and links`,
    url: SITE,
    text: tidy(
      `${AUTHOR} can be reached by email at ${contact.email}. ` +
      `His code is at ${contact.github}, his LinkedIn at ${contact.linkedin}, ` +
      `and his site at ${SITE}. He is based in ${contact.location}.`
    ),
  });

  const body = {
    author: AUTHOR,
    site: SITE,
    /**
     * Bumped when the shape changes, so a consumer can tell a format change
     * from a content change without diffing every document.
     */
    schema: 1,
    generated: new Date().toISOString(),
    documents: raw,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      /**
       * Public and cacheable, but revalidated often: this is the file that
       * makes "ResearchLens knows what the site knows" true, and a long cache
       * would make the promise false for as long as it held.
       */
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      // The Space fetches this cross-origin.
      'Access-Control-Allow-Origin': '*',
    },
  });
};
