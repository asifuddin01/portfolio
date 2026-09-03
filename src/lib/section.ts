/**
 * What part of the book a page belongs to, from its path.
 *
 * Derived rather than declared. The alternative was a `section` prop on every
 * route, which is thirty-odd places to forget one — and a page whose section
 * was forgotten does not fail a build, it just files itself under nothing and
 * disappears from a filter nobody notices is short.
 *
 * The order matters: the first prefix that matches wins, so the longer paths
 * come before the shorter ones they sit under.
 */
const SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['/elementa/apparatus', 'Apparatus'],
  ['/elementa', 'Elementa'],
  ['/marginalia/lectiones', 'Lectiones'],
  ['/marginalia/bibliotheca', 'Bibliotheca'],
  ['/marginalia', 'Marginalia'],
  ['/papers', 'Papers'],
  ['/works', 'Papers'],
  ['/tabulae', 'Tabulae'],
  ['/imagines', 'Imagines'],
  ['/vitae', 'Vitae'],
  ['/researchlens', 'ResearchLens'],
  ['/home', 'Summa'],
];

/**
 * The section label for a pathname. Everything unclaimed is "Frontispiece",
 * which is what '/' is and where the few one-off pages belong.
 */
export function sectionFor(pathname: string): string {
  const p = pathname.replace(/\/+$/, '') || '/';
  for (const [prefix, label] of SECTIONS) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return label;
  }
  return 'Frontispiece';
}
