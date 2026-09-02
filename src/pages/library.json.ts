import type { APIRoute } from 'astro';
import { SITE, AUTHOR } from '../consts';
import { getLibrary } from '../lib/collections';

/**
 * The library manifest — papers added through /admin, for ResearchLens to index.
 *
 * A list of addresses rather than a corpus. The two existing fetched sources —
 * `/author.json` and `/elementa.json` — ship their text, because the site is
 * the thing that holds it. A paper is different: the PDF is the artefact, the
 * parser that turns one into passages already exists in ResearchLens, and it
 * is a better parser than anything this build step would do. So the site says
 * *what* is in the library and the retrieval system decides what a page of it
 * means.
 *
 * That split also keeps the failure modes apart. A PDF that will not parse is
 * a retrieval problem and shows up in ResearchLens's own diagnostics; it does
 * not break `astro build` or take the website down with it.
 *
 * Regenerated on every push, /admin commits included, so adding a paper
 * publishes it to the index within one cache window and with nothing to
 * remember.
 */
export const GET: APIRoute = async () => {
  const papers = await getLibrary();

  const documents = papers.map((p) => ({
    id: `library:${p.id}`,
    title: p.data.title,
    authors: p.data.authors,
    year: p.data.year,
    note: p.data.note ?? '',
    /* Absolute: the consumer is another origin and has nothing to resolve
       a relative path against. */
    url: new URL(p.data.pdf, SITE).href,
    /* Where a reader can see it in context, rather than as a bare file. */
    page: new URL('/papers#library', SITE).href,
  }));

  return new Response(
    JSON.stringify(
      { author: AUTHOR, site: SITE, schema: 1, generated: new Date().toISOString(), documents },
      null,
      2
    ),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
  );
};
