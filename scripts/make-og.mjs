/**
 * Renders the social card once, at build-authoring time, to public/og.png.
 * macOS ships Didot, a didone in the same register as Bodoni Moda, so the
 * card matches the site without embedding a webfont.
 *
 * Run: node scripts/make-og.mjs
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const LESION = ['#8C2F26', '#4E1E2C', '#C9A227', '#93A98F', '#2F566D'];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#E7E1CE"/>
  <rect x="40" y="40" width="1120" height="550" fill="none" stroke="#94762F" stroke-width="1"/>

  <text x="96" y="250" font-family="Didot, 'Bodoni 72', 'Times New Roman', serif"
        font-size="92" fill="#191713" letter-spacing="2">Md. Asif Uddin</text>

  <text x="98" y="308" font-family="'IBM Plex Mono', Menlo, monospace"
        font-size="22" fill="#4A443A" letter-spacing="3.4">DEEP LEARNING RESEARCHER</text>
  <text x="98" y="344" font-family="'IBM Plex Mono', Menlo, monospace"
        font-size="22" fill="#4A443A" letter-spacing="3.4">MEDICAL IMAGING · VISION-LANGUAGE · CAUSAL INFERENCE</text>

  <line x1="98" y1="418" x2="470" y2="418" stroke="#94762F" stroke-width="1"/>
  ${LESION.map((c, i) => `<circle cx="${508 + i * 34}" cy="418" r="7" fill="${c}"/>`).join('')}
  <line x1="${508 + 4 * 34 + 38}" y1="418" x2="1104" y2="418" stroke="#94762F" stroke-width="1"/>

  <text x="98" y="486" font-family="Didot, 'Bodoni 72', 'Times New Roman', serif"
        font-size="30" font-style="italic" fill="#191713">“Correlation is cheap. Only an intervention costs anything.”</text>

  <text x="98" y="548" font-family="'IBM Plex Mono', Menlo, monospace"
        font-size="19" fill="#94762F" letter-spacing="3.4">DHAKA, BANGLADESH</text>
</svg>`;

const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
await writeFile('public/og.png', png);
console.log(`public/og.png written — ${(png.length / 1024).toFixed(0)} KB`);
