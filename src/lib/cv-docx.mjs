/**
 * The CV as a Word document.
 *
 * The PDF is the document to send. This is the one to hand somebody who will
 * paste it into their own template, and the one an applicant-tracking system
 * can read without guessing at a page layout — which is most of them, and is
 * why a CV that only exists as a PDF sometimes arrives as a wall of nothing.
 *
 * Written out by hand, like `cv-layout.mjs` writes the PDF and `og-card.mjs`
 * writes the social cards. A .docx is a zip of four small XML files, and the
 * alternative was half a megabyte of dependency to produce them. Nothing here
 * is clever; it is just the format, stated.
 *
 * It reads the same object the PDF renderer does — the one `buildCv` returns,
 * after the proof sheet has applied edits and dropped excluded entries — so
 * the two downloads cannot describe different careers.
 */

/* ---- the smallest zip that Word will open ---------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Store the entries uncompressed.
 *
 * A CV is a few kilobytes of XML, so deflating it would save nothing worth the
 * code — and "stored" is a first-class zip method, not a shortcut: Word,
 * LibreOffice and Pages all open it.
 */
function zip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const [name, text] of Object.entries(files)) {
    const data = enc.encode(text);
    const nameBytes = enc.encode(name);
    const sum = crc32(data);
    const header = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), // no timestamp: the same input gives the same file
      ...u32(sum), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0),
    ];
    parts.push(new Uint8Array(header), nameBytes, data);
    central.push({ name: nameBytes, sum, size: data.length, offset });
    offset += header.length + nameBytes.length + data.length;
  }

  const dir = [];
  for (const e of central) {
    dir.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(e.sum), ...u32(e.size), ...u32(e.size),
      ...u16(e.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(e.offset),
    );
    dir.push(...e.name);
  }
  const dirBytes = new Uint8Array(dir);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(central.length), ...u16(central.length),
    ...u32(dirBytes.length), ...u32(offset), ...u16(0),
  ]);

  const total = parts.reduce((n, p) => n + p.length, 0) + dirBytes.length + end.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  out.set(dirBytes, at); at += dirBytes.length;
  out.set(end, at);
  return out;
}

/* ---- the document ----------------------------------------------------- */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** One run of text. `w:b` bold, `w:i` italic, size in half-points. */
function run(text, { bold = false, italic = false, size = 20, colour = '1A1917' } = {}) {
  if (!clean(text)) return '';
  return (
    '<w:r><w:rPr>' +
    (bold ? '<w:b/>' : '') +
    (italic ? '<w:i/>' : '') +
    `<w:color w:val="${colour}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` +
    `</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
  );
}

function para(runs, { space = 60, align = null, border = false } = {}) {
  const inner = Array.isArray(runs) ? runs.join('') : runs;
  if (!inner) return '';
  return (
    '<w:p><w:pPr>' +
    `<w:spacing w:after="${space}"/>` +
    (align ? `<w:jc w:val="${align}"/>` : '') +
    (border ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:color="94762F"/></w:pBdr>' : '') +
    '</w:pPr>' + inner + '</w:p>'
  );
}

/**
 * An item, rendered by the same rules the PDF uses.
 *
 * `note` puts the label inline with the text — "Languages. Bangla, native." —
 * because that is a sentence, not an entry. Everything else gets the title on
 * its own line with the date pushed to the right of it, which in a Word
 * document means a tab rather than a measured column.
 */
function item(it, style) {
  const title = clean(it.title);
  const right = clean(it.right);
  const subtitle = clean(it.subtitle);
  const detail = clean(it.detail);

  if (style === 'note') {
    /* The label arrives as its own field. It used to be recovered from the
       text with a regular expression that took everything up to the first full
       stop — which is wrong the moment a label has no stop, or the prose has
       one early. */
    return (
      para(run(title ? `${title}.` : '', { bold: true, size: 18 }), { space: 20 }) +
      para(run(detail, { size: 18, colour: '4A443A' }), { space: 140 })
    );
  }

  const head = [];
  if (title) head.push(run(title, { bold: true, size: 19 }));
  if (right) {
    head.push('<w:r><w:tab/></w:r>');
    head.push(run(right, { size: 17, colour: '94762F' }));
  }

  return (
    (head.length
      ? '<w:p><w:pPr><w:spacing w:after="20"/>' +
        '<w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs>' +
        '</w:pPr>' + head.join('') + '</w:p>'
      : '') +
    para(run(subtitle, { italic: true, size: 18, colour: '4A443A' }), { space: 20 }) +
    para(run(detail, { size: 17, colour: '4A443A' }), { space: 140 })
  );
}

/** The CV as .docx bytes. Same input as `renderCv`. */
export function renderCvDocx(cv) {
  const body = [];

  body.push(para(run(cv.author, { bold: true, size: 40 }), { space: 60 }));
  body.push(para(run((cv.contact ?? []).join('  ·  '), { size: 17, colour: '4A443A' }), { space: 200 }));
  if (clean(cv.summary)) {
    body.push(para(run(cv.summary, { size: 18, colour: '1A1917' }), { space: 220 }));
  }

  for (const section of cv.sections ?? []) {
    const items = (section.items ?? []).filter(
      (it) => clean(it.title) || clean(it.subtitle) || clean(it.detail),
    );
    if (!items.length) continue;
    body.push(
      para(run(String(section.heading).toUpperCase(), { bold: true, size: 18, colour: '94762F' }),
           { space: 60, border: true }),
    );
    for (const it of items) body.push(item(it, section.style));
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/>
</w:sectPr></w:body></w:document>`;

  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    'word/document.xml': document,
  });
}
