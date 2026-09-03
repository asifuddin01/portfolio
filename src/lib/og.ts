/**
 * Where a page's social card lives.
 *
 * Derived from the path rather than declared, for the same reason the search
 * section is: four hundred routes is four hundred chances to forget, and a page
 * that forgot would silently fall back to the shared card — the exact failure
 * this replaces, reintroduced one page at a time.
 *
 * The images themselves are written after the build by `scripts/build-og.mjs`,
 * which reads the address out of each built page and renders exactly that file.
 * So this function is the single definition of the scheme: nothing else needs
 * to agree with it, because everything else reads it from the HTML.
 */
export function ogPathFor(pathname: string): string {
  const clean = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  return `/og/${clean || 'index'}.png`;
}
