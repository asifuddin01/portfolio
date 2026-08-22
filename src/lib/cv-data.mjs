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
  author = '', siteUrl = '', fallback = {},
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

  if (projects.length) {
    sections.push({
      id: 'engineering',
      heading: 'Engineering',
      style: 'project',
      items: [...projects].sort(byOrder).map((p) => ({
        title: p.data.title ?? '',
        detail: p.data.cvSummary ?? p.data.summary ?? '',
      })),
    });
  }

  if (cvMeta.languages) {
    sections.push({
      id: 'additional',
      heading: 'Additional',
      style: 'note',
      items: [{ detail: `Languages. ${cvMeta.languages}` }],
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
