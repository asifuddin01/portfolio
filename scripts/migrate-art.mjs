/** One-off: turn plates.json into editable MDX entries under src/content/art. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const plates = JSON.parse(await readFile('src/lib/plates.json', 'utf8'));

/** Home-scroll arrangement, preserved from the hand-built version. */
const LAYOUT = {
  melencolia:   { order: 1, side: 'right', treatment: 'intaglio' },
  'saint-jerome': { order: 2, side: 'right', treatment: 'intaglio' },
  'knight-death': { order: 3, side: 'left', treatment: 'intaglio' },
  anatomy:      { order: 4, side: 'right', treatment: 'intaglio' },
  carceri:      { order: 5, side: 'left', treatment: 'intaglio' },
  meditation:   { order: 6, side: 'right', treatment: 'photograph' },
  bust:         { order: 7, side: 'left', treatment: 'photograph' },
  scholar:      { order: 8, side: 'right', treatment: 'intaglio' },
  'sleep-reason': { order: 9, side: 'left', treatment: 'intaglio' },
};

/** Short factual notes, written as seeds for the owner to expand or replace. */
const BACKGROUND = {
  melencolia: `One of the three *Meisterstiche* — the master engravings Dürer made in 1513 and 1514, alongside *Knight, Death and the Devil* and *St Jerome in His Study*. A winged figure sits among the instruments of measurement and construction: compass, scales, hourglass, plane, a truncated polyhedron, a magic square. None of them is in use.

The square in the upper right is a 4×4 magic square whose bottom row contains 15 and 14, giving the year.

It is usually read against the Renaissance theory of the humours, in which melancholy was the temperament of the scholar and the artist — the condition that makes thought possible and also stops it.`,

  'saint-jerome': `The companion to *Melencolia I*, engraved in the same year, and its argument in reverse. Where melancholy sits paralysed among unused instruments, Jerome works: the light is warm, the lion and the dog are asleep, the room is in order.

The skull on the sill and the hourglass on the wall are the same memento mori that appear in the other plate. Here they do not interrupt the work.`,

  'knight-death': `The earliest of the three master engravings, 1513. A knight rides through a narrow defile accompanied by Death, who holds up an hourglass, and by a devil behind him. He does not look at either.

The subject is usually connected to Erasmus's *Handbook of a Christian Knight*, though Dürer left no note saying so.`,

  'sleep-reason': `Plate 43 of *Los Caprichos*, Goya's suite of eighty etchings published in 1799. The artist slumps over his desk while owls and bats rise behind him; the caption is written on the desk itself.

Goya withdrew the series from sale not long after it appeared. The Spanish is *El sueño de la razón produce monstruos*, and *sueño* carries both senses — sleep and dream — which is why the plate is argued over: reason asleep, or reason dreaming.`,

  carceri: `From the *Carceri d'invenzione*, the imaginary prisons. Piranesi first issued them around 1749–50 and reworked the plates about a decade later, darkening them considerably.

They are architecture that cannot be built: staircases that arrive nowhere, machinery at a scale with no purpose, space that continues past every edge of the sheet.`,

  scholar: `Rembrandt etched himself repeatedly across his working life. This one, from 1648, shows him seated at a window with a plate or drawing in front of him — the artist depicted not as a subject but as someone at work.`,

  anatomy: `A sheet of studies of the musculature of the arm and torso. Anatomical study was ordinary practice for painters of this period: the point was not medical knowledge but knowing what the surface is doing because of what lies under it.

It is the ancestor of every numbered figure on this site.`,

  bust: `Roman portrait sculpture. The tradition it belongs to is unusual in ancient art for its willingness to record a particular face rather than an idealised one.`,

  meditation: `A bronze from the Chola period of southern India, roughly the twelfth century. The hands rest in *dhyana mudra*, the gesture of meditation.

Set here against the European engravings deliberately: a different tradition, arriving at stillness by a different road.`,
};

await mkdir('src/content/art', { recursive: true });

for (const p of plates) {
  const layout = LAYOUT[p.slug] ?? { order: 99, side: 'right', treatment: 'intaglio' };
  const fm = [
    '---',
    `order: ${layout.order}`,
    `title: ${JSON.stringify(p.title)}`,
    `artist: ${JSON.stringify(p.artist ?? 'Unknown')}`,
    `date: ${JSON.stringify(p.date ?? '')}`,
    `image: ../../assets/plates/${p.file}`,
    `alt: ${JSON.stringify(`${p.title}${p.artist ? `, ${p.artist}` : ''}`)}`,
    `gloss: ${JSON.stringify(p.note ?? '')}`,
    `credit: ${JSON.stringify(p.credit ? 'Art Institute of Chicago · CC0' : 'Art Institute of Chicago · CC0')}`,
    `source: ${JSON.stringify(p.sourceUrl ?? null)}`,
    `treatment: ${layout.treatment}`,
    `side: ${layout.side}`,
    'onHome: true',
    'status: published',
    '---',
    '',
    BACKGROUND[p.slug] ?? '[SUPPLY — a note on this image]',
    '',
  ].join('\n');
  await writeFile(`src/content/art/${p.slug}.mdx`, fm);
  console.log(`  ✓ ${p.slug}`);
}
console.log(`\n${plates.length} tabulae written`);
