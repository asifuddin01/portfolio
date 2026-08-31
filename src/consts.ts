/** Single source of site-wide constants. Change SITE after the domain is bought. */
export const SITE = 'https://asifuddin.com';

export const AUTHOR = 'Md. Asif Uddin';
export const ROLE =
  'Deep learning researcher — medical imaging, vision-language models, causal inference';
export const LOCATION = 'Dhaka, Bangladesh';
export const EMAIL = 'md.asif.uddin@g.bracu.ac.bd';
export const GITHUB = 'https://github.com/asifuddin01';
export const LINKEDIN = 'https://linkedin.com/in/md-asif-uddin01';

/**
 * The primary nav. No entry for the home page: the wordmark to its left is
 * already a link there, and two controls doing the same thing costs a slot
 * without buying anything.
 */
export const NAV = [
  { href: '/elementa', label: 'Elementa' },
  { href: '/papers', label: 'Papers' },
  { href: '/tabulae', label: 'Tabulae' },
  { href: '/marginalia', label: 'Marginalia' },
  { href: '/researchlens', label: 'ResearchLens' },
  { href: '/vitae', label: 'Vitae' },
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
