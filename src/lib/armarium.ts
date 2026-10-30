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
