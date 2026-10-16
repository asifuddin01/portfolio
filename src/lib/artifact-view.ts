/**
 * How an artifact's file is shown: in the private archive's viewer, and on
 * the page a shared link opens. One place, so the two cannot drift apart in
 * how they frame a page someone else will read.
 */

export interface Viewable {
  kind: string;
  title: string;
  name: string | null;
  size: number | null;
}

export function bytes(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * The body for any artifact that has a file. `url` gives the file's address,
 * with extra query parameters (`download`, `theme=dark`) when asked.
 */
export function artifactBody(it: Viewable, url: (extra?: string) => string): HTMLElement {
  const src = url();
  const theme = document.documentElement.dataset.theme === 'nocturne' ? 'dark' : 'light';
  const coarse = matchMedia('(pointer: coarse)').matches;

  // No `sandbox` attribute on these frames. The Worker sends every HTML,
  // Markdown and text file with a `Content-Security-Policy: sandbox` header,
  // which gives the document an opaque origin of its own — the frame is
  // cross-origin to this page, and its scripts cannot reach the site's
  // storage. The header is the control that also holds in a tab of its own;
  // doubling it with the attribute stopped some embedded browsers from
  // loading the frame at all, for no gain in isolation.
  if (it.kind === 'html') {
    const f = el('iframe', 'av-frame');
    f.title = it.title;
    f.src = src;
    return f;
  }
  if (it.kind === 'markdown' || it.kind === 'text') {
    const f = el('iframe', 'av-frame av-frame--doc');
    f.title = it.title;
    f.src = it.kind === 'markdown' ? url(`theme=${theme}`) : src;
    return f;
  }
  if (it.kind === 'image' || it.kind === 'svg') {
    const img = el('img', 'av-img');
    img.alt = it.title;
    img.src = src;
    return img;
  }
  if (it.kind === 'pdf' && !coarse) {
    // No sandbox: browsers will not start their PDF viewer inside one.
    const f = el('iframe', 'av-frame');
    f.title = it.title;
    f.src = src;
    return f;
  }

  const panel = el('div', 'av-panel');
  if (it.kind === 'pdf') {
    // Phones show only the first page of a framed PDF, so open it whole.
    panel.append(el('p', undefined, `${it.name ?? 'PDF'} · ${bytes(it.size)}`));
    panel.append(Object.assign(el('a', 'av-btn av-btn--primary', 'Open the PDF'), { href: src, target: '_blank', rel: 'noopener' }));
  } else {
    panel.append(el('p', undefined, `${it.name ?? 'File'} · ${bytes(it.size)}`));
    panel.append(Object.assign(el('a', 'av-btn av-btn--primary', 'Download'), { href: url('download') }));
  }
  return panel;
}
