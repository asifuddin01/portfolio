/**
 * Shapes the content collections into the one structure that both the PDF
 * renderer and the proof page read.
 *
 * The point of this file is that there is exactly one place where "what goes
 * on the CV" is decided. The build script reads frontmatter off disk and the
 * proof page reads it through getCollection, but they both hand it to this
 * function, so the PDF anyone downloads and the draft shown on screen cannot
 * describe different careers.
 *
 * Kept as .mjs with no imports so a plain node script and Vite can both load
 * it unchanged.
 */

import { fillFacts } from './facts.mjs';

const byOrder = (a, b) => (a.data.order ?? 0) - (b.data.order ?? 0);

const STATE = {
  published: 'Published',
  preprint: 'Preprint',
  'under-review': 'Under review',
  'in-preparation': 'In preparation',
};

const PLATE_STATUS = {
  deposited: 'Deposited',
  'in-preparation': 'In preparation',
  'under-review': 'Under review',
  'proposal-accepted': 'Proposal accepted',
};

const host = (u) => String(u ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');

/**
 * @param input.site        the `site` collection — supplies the cv and contact singletons
 * @param input.fallback    consts.ts values, used when the contact entry is silent
 * @returns a plain object; every leaf is a string, so the editor can treat any
 *          field as text without knowing which section it came from
 */
export function buildCv({
  site = [], works = [], papers = [], education = [], projects = [], skills = [],
  referees = [], author = '', siteUrl = '', fallback = {},
  /** Offer empty blocks to type into. The editor sets this; the public page
      does not, so a section nobody has filled in never reaches a reader. */
  blanks = false,
} = {}) {
  const find = (id) => site.find((e) => e.id === id)?.data ?? {};
  const cvMeta = find('cv');
  const contact = find('contact');

  const email = contact.email ?? fallback.email ?? '';
  const github = contact.github ?? fallback.github ?? '';
  const linkedin = contact.linkedin ?? fallback.linkedin ?? '';
  const location = contact.location ?? fallback.location ?? '';

  const sections = [];

  if (education.length) {
    sections.push({
      id: 'education',
      heading: 'Education',
      style: 'entry',
      items: [...education].sort(byOrder).map((e) => ({
        title: `${e.data.degree} — ${e.data.institution}, ${e.data.location}`,
        right: e.data.period ?? '',
        // Grades belong here and on /vitae, but not in the Chronicle.
        detail: [e.data.result, e.data.detail].filter(Boolean).join('. ').replace(/\.\./g, '.'),
      })),
    });
  }

  if (works.length) {
    sections.push({
      id: 'research',
      heading: 'Research',
      style: 'work',
      // Title and what the work does. No metrics — results belong on the plate.
      items: [...works].sort((a, b) => a.data.plate - b.data.plate).map((w) => {
        const who = [];
        if (w.data.supervisors?.length) {
          who.push(`Supervisor${w.data.supervisors.length > 1 ? 's' : ''}: ${w.data.supervisors.join(', ')}`);
        }
        if (w.data.status) who.push(PLATE_STATUS[w.data.status] ?? w.data.status);
        return {
          title: w.data.title ?? '',
          right: w.data.year ?? '',
          subtitle: w.data.subtitle ?? '',
          detail: who.length ? who.join('. ') + '.' : '',
        };
      }),
    });
  }

  if (papers.length) {
    const RANK = { published: 0, preprint: 1, 'under-review': 2, 'in-preparation': 3 };
    sections.push({
      id: 'papers',
      heading: 'Papers and manuscripts',
      style: 'paper',
      items: [...papers]
        .sort((a, b) =>
          (RANK[a.data.state] ?? 9) - (RANK[b.data.state] ?? 9) ||
          String(b.data.year).localeCompare(String(a.data.year)))
        .map((p) => ({
          title: p.data.title ?? '',
          right: `${STATE[p.data.state] ?? ''} ${p.data.year ?? ''}`.trim(),
          detail: [p.data.venue, p.data.url].filter(Boolean).join('  ·  '),
        })),
    });
  }

  /**
   * Engineering, split in two.
   *
   * One "Engineering" heading put a retrieval system that answers from 103
   * indexed papers next to a university marketplace assignment, and a reader
   * skimming the section had to work out which was which from the prose. The
   * systems are the argument; the coursework is evidence of range. They are
   * different claims and now they are different headings, in that order.
   *
   * The split is the `system` flag the frontispiece already uses to decide
   * what appears under "Systems that run" — one property, two consumers,
   * rather than a second list to keep in step.
   */
  const projectSection = (id, heading, list) =>
    list.length && {
      id,
      heading,
      style: 'project',
      items: list.map((p) => ({
        title: p.data.title ?? '',
        /* The CV states the same figures as the site and must resolve the
           same tokens. Sharing the filler rather than repeating the numbers is
           the whole point: a PDF that disagreed with the page it was generated
           from would be the worst place for this to drift. */
        detail: fillFacts(p.data.cvSummary ?? p.data.summary ?? ''),
      })),
    };

  const ordered = [...projects].sort(byOrder);
  const built = projectSection('systems', 'AI systems', ordered.filter((p) => p.data.system));
  const other = projectSection('projects', 'Other projects', ordered.filter((p) => !p.data.system));
  if (built) sections.push(built);
  if (other) sections.push(other);

  if (skills.length) {
    sections.push({
      id: 'technical',
      heading: 'Technical',
      style: 'skill',
      items: [...skills].sort(byOrder).map((s) => ({
        title: s.data.title ?? '',
        detail: s.data.items ?? '',
      })),
    });
  }

  /* Additional holds small titled blocks rather than one paragraph each.
     The label is its own field, not the first sentence of the text: the proof
     sheet then offers it as a separate box to retype, and the renderers can
     set it in bold on its own line without parsing the prose to find where the
     label stopped. Each is its own item, which is what gives it its own
     include switch. */
  const notes = [
    cvMeta.languages && { title: 'Languages', detail: cvMeta.languages },
    cvMeta.interests && { title: 'Reading and research interests', detail: cvMeta.interests },
  ].filter(Boolean);
  if (notes.length) {
    sections.push({
      id: 'additional',
      heading: 'Additional',
      style: 'note',
      items: notes,
    });
  }

  /* Last on the page, after everything it might vouch for. A referee is the
     closing line of a CV, not a section somebody reads on the way to the
     languages. */
  if (referees.length) {
    sections.push({
      id: 'referees',
      heading: 'References',
      style: 'entry',
      items: [...referees].sort(byOrder).map((r) => ({
        title: r.data.name ?? '',
        subtitle: [r.data.role, r.data.affiliation].filter(Boolean).join(', '),
        detail: [r.data.email, r.data.note].filter(Boolean).join('  ·  '),
      })),
    });
  } else if (blanks) {
    /**
     * An empty References block, in the editor only.
     *
     * A referee is often written for one application and not for the site —
     * and a referee's email on a page anyone can crawl is a different thing
     * from one on a document handed to a person. So the proof sheet offers a
     * block to type into, the typing stays in the browser, and nothing about
     * that referee is ever published.
     *
     * The fields carry prompts rather than being empty, because the proof
     * sheet drops fields with no value and an empty entry would be nothing to
     * click. It arrives with its include switch off, so a proof nobody filled
     * in generates a CV with no References section rather than one advertising
     * the word "Name".
     */
    sections.push({
      id: 'referees',
      heading: 'References',
      style: 'entry',
      items: [{
        blank: true,
        title: 'Name',
        subtitle: 'Role, institution',
        detail: 'email  ·  how they know the work',
      }],
    });
  }

  return {
    author,
    // The phone number is deliberately absent. This file is served publicly,
    // and a number on a public page is a different exposure from one on a CV
    // handed to a person.
    contact: [location, email, host(linkedin), host(github), host(siteUrl)].filter(Boolean),
    summary: cvMeta.summary ?? '',
    sections,
    siteHost: host(siteUrl),
  };
}
