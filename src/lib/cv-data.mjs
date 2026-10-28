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
  thesis: 'Thesis',
};

const PLATE_STATUS = {
  deposited: 'Deposited',
  'in-preparation': 'In preparation',
  preprint: 'Preprint',
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
  site = [], works = [], papers = [], software = [], education = [], projects = [], skills = [],
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
  const orcid = contact.orcid ?? fallback.orcid ?? '';
  // The profile address without its language parameter, which reads as noise on paper.
  const scholar = String(contact.scholar ?? fallback.scholar ?? '').replace(/[?&]hl=[a-z-]+/i, '');
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

  /**
   * Research and publications, as one section.
   *
   * There used to be two: "Research" listed the plates and "Papers and
   * manuscripts" listed the papers, and every plate with a paper behind it
   * appeared in both, so a reader met the same four pieces of work twice.
   * A plate and its paper share an id (works/hierarchiretina and
   * papers/hierarchiretina), so each piece of work is now one entry: the
   * paper's citable title and authors when there is a paper, the plate's
   * one-line account of what it does, its status, venue and link. A plate with
   * no paper yet (a proposal) keeps its own title; a paper with no plate is
   * still listed. A thesis stays under Education, as before.
   *
   * Order: public and submitted work first, then work in preparation, then
   * proposals; plate order within each.
   */
  if (works.length || papers.length) {
    const TIER = { deposited: 0, published: 0, 'under-review': 1, preprint: 1, 'in-preparation': 2, 'proposal-accepted': 3 };
    const paperOf = new Map(papers.filter((p) => p.data.state !== 'thesis').map((p) => [p.id, p]));
    const entries = [...works].sort((a, b) => a.data.plate - b.data.plate).map((w) => {
      const p = paperOf.get(w.id);
      paperOf.delete(w.id);
      return { w, p, tier: TIER[w.data.status] ?? 9, order: w.data.plate };
    });
    for (const p of paperOf.values()) entries.push({ w: null, p, tier: TIER[p.data.state] ?? 9, order: 99 });
    entries.sort((a, b) => a.tier - b.tier || a.order - b.order);

    sections.push({
      id: 'research',
      heading: 'Research and publications',
      style: 'work',
      // What the work does and where it stands. No metrics — results belong on the plate.
      items: entries.map(({ w, p }) => {
        const status = w ? PLATE_STATUS[w.data.status] ?? w.data.status : STATE[p.data.state] ?? p.data.state;
        const bits = [];
        // A supervisor who is also an author is marked in the author list
        // rather than named a second time after it.
        const sup = w?.data.supervisors ?? [];
        const authors = p?.data.authors ?? [];
        if (authors.length) bits.push(`${authors.map((a) => (sup.includes(a) ? `${a} (supervisor)` : a)).join(', ')}.`);
        const others = sup.filter((x) => !authors.includes(x));
        if (others.length) bits.push(`Supervisor${others.length > 1 ? 's' : ''}: ${others.join(', ')}.`);
        const where = [p?.data.venue || w?.data.venue, p?.data.url].filter(Boolean).join('  ·  ');
        if (where) bits.push(where);
        return {
          title: p?.data.title || w?.data.title || '',
          right: `${status} ${(w ?? p).data.year ?? ''}`.trim(),
          subtitle: w?.data.subtitle ?? p?.data.summary ?? '',
          detail: bits.join(' '),
        };
      }),
    });
  }

  /* Archived code with a DOI, cited as software. The all-versions DOI, so the
     line stays true when a new release is archived. */
  if (software.length) {
    sections.push({
      id: 'software',
      heading: 'Software',
      style: 'work',
      items: [...software].sort((a, b) => String(b.data.year).localeCompare(String(a.data.year))).map((s) => ({
        title: s.data.title ?? '',
        right: `${s.data.publisher ?? ''} ${s.data.year ?? ''}`.trim(),
        detail: [(s.data.authors ?? []).join(', '), `doi: ${s.data.doi}`, s.data.repo].filter(Boolean).join('  ·  '),
      })),
    });
  }

  /**
   * Engineering, split in three.
   *
   * One "Engineering" heading put a retrieval system that answers from 103
   * indexed papers next to a university marketplace assignment, and a reader
   * skimming the section had to work out which was which from the prose. Two
   * headings fixed that but still mixed a from-scratch ViT and a MONAI fix in
   * with coursework, and left Vi-Graph and Lucy out of the AI systems. Each
   * project now says which section it belongs to (`section`, editable in
   * /admin): AI systems first, then AI projects, then other software.
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
  // Three sections, by the project's own `section` field: AI systems, AI
  // projects, and other software. `system` is not used here; it means "a
  // stranger can open it now", which is a narrower claim than "AI system".
  for (const [id, heading, key] of [
    ['systems', 'AI systems', 'ai-system'],
    ['ai-projects', 'AI projects', 'ai-project'],
    ['projects', 'Other projects', 'other'],
  ]) {
    const s = projectSection(id, heading, ordered.filter((p) => (p.data.section ?? 'other') === key));
    if (s) sections.push(s);
  }

  if (skills.length) {
    sections.push({
      id: 'technical',
      heading: 'Technical',
      style: 'skill',
      items: [...skills].filter((s) => s.data.onCv !== false).sort(byOrder).map((s) => ({
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
    contact: [location, email, host(linkedin), host(github), host(orcid), host(scholar), host(siteUrl)].filter(Boolean),
    summary: cvMeta.summary ?? '',
    sections,
    siteHost: host(siteUrl),
  };
}
