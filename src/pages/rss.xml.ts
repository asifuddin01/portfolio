import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { SITE, AUTHOR, toRoman } from '../consts';
import {
  getMarginalia, getLectiones, getPropositionContexts,
} from '../lib/collections';

/**
 * One feed for everything that gets written.
 *
 * Three collections carry an `updated` date — marginalia, the reading course,
 * and the Elementa's propositions — and those are exactly the things that
 * appear over time. Papers and plates are deliberately absent: they change
 * state rather than arriving, and a feed that re-announced a manuscript every
 * time its status moved would be noise.
 *
 * One feed rather than three. A reader following this wants to know when there
 * is something new to read, not to choose in advance which of three streams
 * that will come from — and the title prefix says which it was, so a single
 * subscription never leaves them guessing.
 */
export const GET: APIRoute = async () => {
  const [entries, parts, props] = await Promise.all([
    getMarginalia(),
    getLectiones(),
    getPropositionContexts(),
  ]);

  type Item = {
    title: string;
    link: string;
    pubDate: Date;
    description: string;
  };

  const items: Item[] = [
    ...entries.map((e) => ({
      title: `Marginalia · ${e.data.title}`,
      link: `/marginalia/${e.id}`,
      pubDate: e.data.updated,
      description: `${e.data.subject} — ${e.data.summary}`,
    })),

    ...parts.map((p) => ({
      title: `Lectiones ${toRoman(p.data.part)} · ${p.data.title}`,
      link: `/marginalia/lectiones/${p.data.part}`,
      pubDate: p.data.updated,
      description: p.data.summary,
    })),

    /**
     * A proposition is cited as Book.Chapter.Proposition everywhere else on
     * the site, so it is cited that way here too. The statement is the whole
     * of it — a proposition asserts one claim, and that claim is the summary.
     */
    ...props.map((c) => ({
      title: `Elementa ${c.id} · ${c.entry.data.statement}`,
      link: `/elementa/${c.book.id}/${c.chapter.id.split('--')[1]}/${c.entry.id}`,
      pubDate: c.entry.data.updated,
      description: c.entry.data.statement,
    })),
  ];

  /* Newest first, and capped. A reader subscribing today should not receive
     eighty years of backlog as unread. */
  items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  return rss({
    title: `${AUTHOR} — writing`,
    description:
      'Reviews and notes, a reading course in machine learning, and the ' +
      'propositions of the Elementa as they are written.',
    site: SITE,
    items: items.slice(0, 60),
    customData: '<language>en-gb</language>',
    /**
     * What a browser shows when somebody clicks "feed".
     *
     * Without it the browser prints its own warning — "This XML file does not
     * appear to have any style information associated with it" — above a
     * syntax-highlighted document tree. Nothing is wrong: it is a file meant
     * for a program, opened by a person. But it reads as a fault, and the
     * person who clicked wanted to subscribe.
     *
     * Feed readers ignore the stylesheet and parse the XML exactly as before,
     * so this changes how the feed looks and nothing about what it is.
     */
    stylesheet: '/rss.xsl',
    /* Absolute, because a feed reader has no page to resolve against. */
    trailingSlash: false,
  });
};
