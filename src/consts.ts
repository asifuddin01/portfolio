/** Single source of site-wide constants. Change SITE after the domain is bought. */
export const SITE = 'https://mdasifuddin.com';

export const AUTHOR = 'Md. Asif Uddin';
export const ROLE =
  'Deep learning researcher — medical imaging, vision-language models, causal inference';
export const LOCATION = 'Dhaka, Bangladesh';
export const EMAIL = 'md.asif.uddin@g.bracu.ac.bd';
export const GITHUB = 'https://github.com/asifuddin01';
export const LINKEDIN = 'https://linkedin.com/in/md-asif-uddin01';

export const NAV = [
  { href: '/', label: 'Frontispiece' },
  { href: '/elementa', label: 'Elementa' },
  { href: '/tabulae', label: 'Tabulae' },
  { href: '/marginalia', label: 'Marginalia' },
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
