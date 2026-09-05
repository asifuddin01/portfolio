/** Single source of site-wide constants. Change SITE after the domain is bought. */
export const SITE = 'https://asifuddin.com';

export const AUTHOR = 'Md. Asif Uddin';
/**
 * The fallback self-description.
 *
 * The one that is actually shown comes from the frontispiece entry, which is
 * editable in /admin; this is what every page falls back to if that entry is
 * missing. It used to be a third independent copy, and the three disagreed:
 * two called him a researcher and one an engineer, and the two that agreed on
 * the noun listed different fields. A reader who moved between the front page,
 * the Summa and the page source got three answers.
 */
export const ROLE =
  'Deep learning researcher — vision, medical imaging, vision-language models, ' +
  'causal inference, bioinformatics and gene sequence analysis';
export const LOCATION = 'Dhaka, Bangladesh';
export const EMAIL = 'md.asif.uddin@g.bracu.ac.bd';
export const GITHUB = 'https://github.com/asifuddin01';
export const LINKEDIN = 'https://linkedin.com/in/md-asif-uddin01';

/**
 * The primary nav. Frontispiece is the home page, which the wordmark to its
 * left also reaches; the duplicate is deliberate, so the way back is named in
 * the row a reader is already scanning and not only in the wordmark.
 * It must stay first: `isActive` matches by prefix, so the '/' entry is the
 * one case the header special-cases to avoid marking every page current.
 */
export const NAV = [
  { href: '/', label: 'Frontispiece' },
  { href: '/elementa', label: 'Elementa' },
  { href: '/papers', label: 'Papers' },
  { href: '/tabulae', label: 'Tabulae' },
  { href: '/marginalia', label: 'Marginalia' },
  { href: '/researchlens', label: 'ResearchLens' },
  { href: '/vitae', label: 'Vitae' },
  { href: '/officina', label: 'Officina' },
] as const;

/** Roman numerals for folio marks and chapter numbers. */
export function toRoman(n: number): string {
  const table: ReadonlyArray<readonly [number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let rest = n;
  for (const [value, glyph] of table) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}
