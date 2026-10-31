/**
 * The shelves of the Armarium, in the order the page lists them. A closed
 * list: the page filters and colours by shelf, and a free-text genre would
 * split one shelf into five spellings. Add a shelf here and in the CMS
 * options (public/admin/config.yml) together.
 */
export const ARMARIUM_SHELVES = {
  'classic-bengali': 'Classic Bengali literature',
  'contemporary-bengali': 'Contemporary Bengali fiction',
  'world-classics': 'World classics',
  'literary-fiction': 'Literary fiction',
  thriller: 'Crime, mystery & thriller',
  horror: 'Horror & supernatural',
  fantasy: 'Fantasy',
  'science-fiction': 'Science fiction',
  'historical-fiction': 'Historical fiction',
  adventure: 'Adventure',
  mythology: 'Mythology & epics',
  'poetry-drama': 'Poetry & drama',
  'history-politics': 'History & politics',
  philosophy: 'Philosophy',
  religion: 'Religion & spirituality',
  'self-development': 'Self-development',
  science: 'Science & computing',
} as const;

/** Lowercase and without Latin accents. Bangla stays as typed, in NFKD, on both sides of a comparison. */
export const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Whether a and b are at most `max` edits apart. */
function near(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    if (Math.min(...cur) > max) return false;
    prev = cur;
  }
  return prev[b.length]! <= max;
}

/**
 * How well a folded query fits any of the folded names, for the search
 * suggestions: 0 begins a name, 1 begins a word in one, 2 is inside one,
 * 3 is a near miss (a typo, or Humayon for Humayun; Latin letters only),
 * 9 is no match. Lower is better.
 */
export function rank(q: string, names: string[]) {
  let best = 9;
  for (const name of names) {
    if (name.startsWith(q)) return 0;
    const i = name.indexOf(q);
    if (i > 0) best = Math.min(best, /[\s.\-:(/]/.test(name[i - 1]!) ? 1 : 2);
    else if (i < 0 && best > 3 && q.length >= 3 && /[a-z]/.test(q)) {
      const max = q.length >= 6 ? 2 : 1;
      if ([name, ...name.split(/[\s.\-:(/]+/)].some((w) => near(q, w.slice(0, q.length), max))) best = 3;
    }
  }
  return best;
}
