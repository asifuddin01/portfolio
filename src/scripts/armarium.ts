/**
 * The Armarium's catalogue: search, filters, sorting, grouping, two views and
 * a card for each book. Everything it needs is in the page's #am-data; it
 * fetches nothing. The book elements are the server-rendered ones, moved
 * rather than rebuilt, so filtering 300 books is a reorder, not a re-render.
 *
 * State lives in the address bar (?q=…&shelf=…), so a filtered view can be
 * bookmarked or sent, and #book=<id> opens a book's card.
 */

interface Book {
  id: string;
  acc: number | null;
  accEnd: number | null;
  volumes: number;
  title: string;
  titleBn: string | null;
  series: string | null;
  seriesNo: number | null;
  author: string | null;
  authors: string[];
  translator: string | null;
  editor: string | null;
  contributors: string | null;
  creditBn: string | null;
  shelves: string[];
  shelfNames: string[];
  category: string | null;
  categoryBn: string | null;
  language: string;
  translated: boolean;
  publisher: string | null;
  pub: string | null;
  description: string | null;
  cover: string | null;
  coverAlt: string;
  status: 'unread' | 'reading' | 'read' | null;
  favourite: boolean;
  added: string | null;
  rating: number | null;
  review: string | null;
}

interface State {
  q: string; shelf: string; lang: string; tr: string; author: string; pub: string;
  series: string; status: string; rate: string; sort: string; group: string; view: string;
}

const KEYS: (keyof State)[] = ['q', 'shelf', 'lang', 'tr', 'author', 'pub', 'series', 'status', 'rate', 'sort', 'group', 'view'];
const DEFAULTS: State = { q: '', shelf: '', lang: '', tr: '', author: '', pub: '', series: '', status: '', rate: '', sort: 'acc', group: '', view: 'covers' };

import { fold, rank, withRating } from '../lib/armarium';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

// Where a rating is saved; the same repository and branch as public/admin/config.yml.
const REPO = 'asifuddin01/portfolio';
const BRANCH = 'main';
/** The GitHub token the CMS keeps after the owner signs in at /admin. */
const githubToken = (): string => {
  try { return JSON.parse(localStorage.getItem('sveltia-cms.user') ?? 'null')?.token ?? ''; } catch { return ''; }
};
// GitHub sends and takes file contents as base64 of the UTF-8 bytes; atob/btoa alone would mangle Bangla.
const fromBase64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const toBase64 = (text: string) => {
  let bin = '';
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin);
};

function init() {
  const root = document.querySelector<HTMLElement>('.am');
  const dataEl = document.getElementById('am-data');
  if (!root || !dataEl || root.dataset.ready) return;
  root.dataset.ready = '1';

  const raw = JSON.parse(dataEl.textContent ?? '{}') as { books: Record<string, Partial<Book>>; shelves: Record<string, string> };
  const { shelves } = raw;
  // The page ships only the fields a book has; fill in the rest, and the
  // search text and sort key, here rather than sending them twice.
  const books: Record<string, Book> = {};
  const search: Record<string, [string, string]> = {};
  const hay = (b: Book) =>
    fold([b.title, b.titleBn, b.series, b.author, b.translator, b.editor, b.contributors, b.creditBn, b.category,
      b.categoryBn, b.publisher, b.description, b.review, b.language, b.acc, ...b.shelfNames].filter(Boolean).join(' '));
  for (const [id, p] of Object.entries(raw.books)) {
    const b = {
      acc: null, accEnd: null, volumes: 1, titleBn: null, series: null, seriesNo: null, author: null, authors: [],
      translator: null, editor: null, contributors: null, creditBn: null, category: null, categoryBn: null,
      translated: false, publisher: null, pub: null, description: null, cover: null, status: null, favourite: false,
      added: null, rating: null, review: null, ...p, id,
    } as Book;
    b.shelfNames = b.shelves.map((s) => shelves[s] ?? s);
    books[id] = b;
    const first = (b.author || b.editor || b.translator || '').split(/;|,|\sand\s/)[0]!.trim();
    const parts = first.replace(/\(.*?\)/g, '').trim().split(/\s+/);
    search[id] = [hay(b), `${parts.at(-1) ?? ''} ${first}`.toLowerCase()];
  }
  const shelfOrder = Object.keys(shelves);
  const tools = root.querySelector<HTMLElement>('[data-tools]')!;
  const results = root.querySelector<HTMLElement>('[data-results]')!;
  const countEl = root.querySelector<HTMLElement>('[data-result-count]')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-reset]')!;
  const dialog = document.querySelector<HTMLDialogElement>('[data-dialog]')!;
  const dialogBody = dialog.querySelector<HTMLElement>('[data-dialog-body]')!;
  const cards = new Map<string, HTMLElement>();
  for (const el of results.querySelectorAll<HTMLElement>('.am-book')) cards.set(el.dataset.id!, el);
  const all = [...cards.keys()];
  const totalVolumes = all.reduce((n, id) => n + books[id]!.volumes, 0);
  tools.hidden = false;

  const params = new URLSearchParams(location.search);
  const state: State = { ...DEFAULTS };
  for (const k of KEYS) state[k] = params.get(k) ?? DEFAULTS[k];

  const q = tools.querySelector<HTMLInputElement>('input[name="q"]')!;
  const selects = [...tools.querySelectorAll<HTMLSelectElement>('select')];

  /* ---------------------------------------------------------------- filter */

  const matches = (b: Book, terms: string[], skip?: keyof State) => {
    const hay = search[b.id]![0];
    if (!terms.every((t) => hay.includes(t))) return false;
    if (skip !== 'shelf' && state.shelf && !b.shelves.includes(state.shelf)) return false;
    if (state.lang && b.language !== state.lang) return false;
    if (state.tr === 'orig' && b.translated) return false;
    if (state.tr === 'tr' && !b.translated) return false;
    if (state.author && !b.authors.includes(state.author)) return false;
    if (state.pub && b.pub !== state.pub) return false;
    if (state.series === '*' && !b.series) return false;
    if (state.series && state.series !== '*' && b.series !== state.series) return false;
    if (state.status === 'fav' && !b.favourite) return false;
    if (state.status === 'unread' && b.status && b.status !== 'unread') return false;
    if ((state.status === 'read' || state.status === 'reading') && b.status !== state.status) return false;
    if (state.rate === 'rated' && !b.rating) return false;
    if (state.rate === 'none' && b.rating) return false;
    if (state.rate === 'review' && !b.review) return false;
    if (/^\d$/.test(state.rate) && (b.rating ?? 0) < +state.rate) return false;
    return true;
  };

  const sorters: Record<string, (a: Book, b: Book) => number> = {
    acc: (a, b) => (a.acc ?? 1e9) - (b.acc ?? 1e9) || cmp(a.title, b.title),
    title: (a, b) => cmp(a.title, b.title),
    author: (a, b) => cmp(search[a.id]![1], search[b.id]![1]) || cmp(a.series ?? '', b.series ?? '') || (a.seriesNo ?? 0) - (b.seriesNo ?? 0) || cmp(a.title, b.title),
    series: (a, b) => (a.series ? 0 : 1) - (b.series ? 0 : 1) || cmp(a.series ?? '', b.series ?? '') || (a.seriesNo ?? 0) - (b.seriesNo ?? 0) || cmp(a.title, b.title),
    added: (a, b) => cmp(b.added ?? '', a.added ?? '') || (b.acc ?? 0) - (a.acc ?? 0),
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || cmp(a.title, b.title),
  };

  /** A group's key and the order groups are listed in. */
  const groupers: Record<string, { key: (b: Book) => string; order: (a: [string, Book[]], b: [string, Book[]]) => number }> = {
    shelf: { key: (b) => shelves[b.shelves[0]!]!, order: (a, b) => shelfOrder.indexOf(keyOfShelf(a[0])) - shelfOrder.indexOf(keyOfShelf(b[0])) },
    author: { key: (b) => b.authors[0] ?? 'Unattributed', order: (a, b) => cmp(search[a[1][0]!.id]![1], search[b[1][0]!.id]![1]) },
    series: { key: (b) => b.series ?? '', order: (a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || cmp(a[0], b[0]) },
    language: { key: (b) => b.language, order: (a, b) => b[1].length - a[1].length },
    pub: { key: (b) => b.pub ?? '', order: (a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || b[1].length - a[1].length || cmp(a[0], b[0]) },
  };
  const keyOfShelf = (name: string) => shelfOrder.find((k) => shelves[k] === name) ?? '';
  const groupLabel = (g: string, key: string) =>
    key || (g === 'series' ? 'Not in a series' : g === 'pub' ? 'Publisher not recorded' : '—');

  let shown: Book[] = [];

  function apply() {
    const terms = fold(state.q).split(/\s+/).filter(Boolean);
    const list = all.map((id) => books[id]!).filter((b) => matches(b, terms));
    list.sort(sorters[state.sort] ?? sorters.acc);
    shown = list;

    const frag = document.createDocumentFragment();
    const g = groupers[state.group];
    if (g) {
      const groups = new Map<string, Book[]>();
      for (const b of list) {
        const k = g.key(b);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(b);
      }
      for (const [key, members] of [...groups].sort(g.order)) {
        const sec = document.createElement('section');
        sec.className = 'am-group';
        const vols = members.reduce((n, b) => n + b.volumes, 0);
        sec.innerHTML = `<h2 class="am-group-h">${esc(groupLabel(state.group, key))} <span class="am-group-n">${vols}</span></h2>`;
        const body = document.createElement('div');
        body.className = 'am-group-body';
        for (const b of members) body.append(cards.get(b.id)!);
        sec.append(body);
        frag.append(sec);
      }
    } else {
      for (const b of list) frag.append(cards.get(b.id)!);
    }
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'am-empty';
      p.textContent = 'No book matches all of that. Try fewer words or clear a filter.';
      frag.append(p);
    }
    results.replaceChildren(frag);
    results.dataset.view = state.view === 'list' ? 'list' : 'covers';

    // Counts on the shelf chips reflect every other filter, so each says what
    // choosing it would show.
    const perShelf = new Map<string, number>();
    for (const id of all) {
      const b = books[id]!;
      if (!matches(b, terms, 'shelf')) continue;
      for (const s of b.shelves) perShelf.set(s, (perShelf.get(s) ?? 0) + b.volumes);
    }
    for (const el of tools.querySelectorAll<HTMLElement>('[data-count]')) {
      el.textContent = String(perShelf.get(el.dataset.count!) ?? 0);
    }
    for (const chip of tools.querySelectorAll<HTMLButtonElement>('[data-shelf-chip]')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.shelfChip === state.shelf));
    }
    for (const b of tools.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      b.setAttribute('aria-pressed', String(b.dataset.view === (state.view || 'covers')));
    }

    const vols = list.reduce((n, b) => n + b.volumes, 0);
    const filtered = KEYS.some((k) => !['sort', 'group', 'view'].includes(k) && state[k] !== DEFAULTS[k]);
    countEl.textContent = filtered
      ? `${vols} of ${totalVolumes} books${list.length !== vols ? ` (${list.length} titles)` : ''}`
      : `All ${totalVolumes} books, ${all.length} titles`;
    resetBtn.hidden = !filtered;

    const next = new URLSearchParams();
    for (const k of KEYS) if (state[k] !== DEFAULTS[k]) next.set(k, state[k]);
    const qs = next.toString();
    history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  }

  function set(patch: Partial<State>, scroll = false) {
    Object.assign(state, patch);
    syncControls();
    apply();
    if (scroll) tools.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function syncControls() {
    q.value = state.q;
    for (const s of selects) {
      const k = s.name as keyof State;
      s.value = state[k];
      // A value from an old link that is no longer an option falls back to any.
      if (s.value !== state[k]) { state[k] = DEFAULTS[k]; s.value = state[k]; }
    }
  }

  /* --------------------------------------------------------------- dialog */

  const by = (label: string, names: string | null) =>
    names ? `<p class="am-d-row"><span class="am-d-k">${label}</span> ${esc(names)}</p>` : '';
  const stars = (r: number) => `<span class="am-stars" style="--r:${r}" aria-hidden="true"></span>`;
  const paragraphs = (t: string) => t.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');

  /** The rating and review controls, for the owner's browser only: the one
   *  holding the CMS's GitHub sign-in, which is what saving needs. */
  function editor(b: Book) {
    if (!githubToken()) return `<p class="am-owner am-d-edit">Sign in at <a class="link" href="/admin/">/admin</a> to rate and review from here.</p>`;
    const r = b.rating ?? 0;
    return `<section class="am-rate" aria-label="Rate and review">
      <p class="am-d-k">Rate and review</p>
      <div class="am-rate-row">
        <span class="am-stars" role="slider" tabindex="0" aria-label="Rating" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${r}" aria-valuetext="${r ? `${r} of 5` : 'Not rated'}" style="--r:${r}" data-rate-stars></span>
        <input type="number" min="0.5" max="5" step="0.5" inputmode="decimal" aria-label="Rating out of five" value="${r || ''}" data-rate-num>
        <button type="button" class="am-linkish" data-rate-clear>Clear</button>
      </div>
      <textarea data-rate-review aria-label="Review" placeholder="What you made of it. Visitors will read this.">${esc(b.review ?? '')}</textarea>
      <p class="am-rate-actions"><button type="button" class="am-btn" data-rate-save>Save</button><span class="am-rate-msg" data-rate-msg aria-live="polite"></span></p>
    </section>`;
  }

  function open(id: string, opener?: HTMLElement | null) {
    const b = books[id];
    if (!b) return;
    const card = cards.get(id);
    const cover = card?.querySelector('.am-cover')?.innerHTML ?? '';
    const sameAuthor = b.authors[0]
      ? all.map((x) => books[x]!).filter((x) => x.id !== id && x.authors.includes(b.authors[0]!)).sort(sorters.series).slice(0, 8)
      : [];
    const sameSeries = b.series
      ? all.map((x) => books[x]!).filter((x) => x.series === b.series).sort(sorters.series)
      : [];
    const statusText = { read: 'Read', reading: 'Reading now', unread: 'Not yet read' } as const;
    dialogBody.innerHTML = `
      <div class="am-d-cover am-cover" data-shelf="${esc(b.shelves[0])}">${cover}</div>
      <div class="am-d-main">
        <p class="am-d-acc">No. ${esc(b.acc ?? '—')}${b.accEnd ? `–${esc(b.accEnd)}` : ''}${b.volumes > 1 ? ` · ${b.volumes} volumes` : ''}${b.favourite ? ' · <span class="am-fav">Favourite</span>' : ''}${b.status ? ` · ${statusText[b.status]}` : ''}</p>
        <h2 class="am-d-title" id="am-d-title">${esc(b.title)}</h2>
        ${b.titleBn && b.titleBn !== b.title ? `<p class="am-d-bn" lang="bn">${esc(b.titleBn)}</p>` : ''}
        ${b.rating ? `<p class="am-d-rating"><span class="am-d-k">My rating</span>${stars(b.rating)} ${b.rating} of 5</p>` : ''}
        ${b.series ? `<p class="am-d-series">${b.seriesNo ? `Book ${esc(b.seriesNo)} of ` : 'Part of '}<button type="button" class="am-linkish" data-go-series="${esc(b.series)}">${esc(b.series)}</button></p>` : ''}
        <div class="am-d-credits">
          ${b.authors.length ? `<p class="am-d-row"><span class="am-d-k">By</span> ${b.authors.map((a) => `<button type="button" class="am-linkish" data-go-author="${esc(a)}">${esc(a)}</button>`).join(', ')}</p>` : ''}
          ${by('Translated by', b.translator)}${by('Edited by', b.editor)}${b.contributors ? `<p class="am-d-row">${esc(b.contributors)}</p>` : ''}
          ${b.creditBn ? `<p class="am-d-row am-d-soft" lang="bn">${esc(b.creditBn)}</p>` : ''}
        </div>
        <p class="am-d-shelves">${b.shelves.map((s, i) => `<button type="button" class="am-chip" data-shelf="${esc(s)}" data-go-shelf="${esc(s)}"><span class="am-swatch" aria-hidden="true"></span>${esc(b.shelfNames[i])}</button>`).join('')}</p>
        <dl class="am-d-facts">
          <div><dt>Language</dt><dd>${esc(b.language)}${b.translated ? ', in translation' : ''}</dd></div>
          ${b.category ? `<div><dt>Kind</dt><dd>${esc(b.category)}${b.categoryBn ? `<br><span lang="bn" class="am-d-soft">${esc(b.categoryBn)}</span>` : ''}</dd></div>` : ''}
          ${b.publisher ? `<div><dt>Publisher</dt><dd><button type="button" class="am-linkish" data-go-pub="${esc(b.pub)}">${esc(b.publisher)}</button></dd></div>` : ''}
          ${b.added ? `<div><dt>Added</dt><dd>${esc(b.added)}</dd></div>` : ''}
        </dl>
        ${b.description ? `<p class="am-d-desc" lang="bn">${esc(b.description)}</p>` : ''}
        ${b.review ? `<div class="am-d-review"><p class="am-d-k">My review</p>${paragraphs(b.review)}</div>` : ''}
        ${sameSeries.length > 1 ? `<div class="am-d-more"><p class="am-d-k">In this series</p><ol>${sameSeries.map((x) => `<li>${x.id === id ? `<strong>${esc(x.title)}</strong>` : `<button type="button" class="am-linkish" data-go-book="${esc(x.id)}">${esc(x.title)}</button>`}</li>`).join('')}</ol></div>` : ''}
        ${!b.series && sameAuthor.length ? `<div class="am-d-more"><p class="am-d-k">More by ${esc(b.authors[0])}</p><ul>${sameAuthor.map((x) => `<li><button type="button" class="am-linkish" data-go-book="${esc(x.id)}">${esc(x.title)}</button></li>`).join('')}</ul></div>` : ''}
        ${editor(b)}
        <p class="am-owner am-d-edit"><a class="link" href="/admin/#/collections/armarium/entries/${esc(id)}">Edit this book</a></p>
      </div>`;
    const img = dialogBody.querySelector('img');
    if (img) { img.alt = b.coverAlt; img.loading = 'eager'; }
    current = id;
    draft = b.rating ?? 0;
    if (!dialog.open) {
      lastOpener = opener ?? lastOpener;
      dialog.showModal();
    }
    dialogBody.scrollTop = 0;
    history.replaceState(history.state, '', `${location.pathname}${location.search}#book=${encodeURIComponent(id)}`);
  }
  let lastOpener: HTMLElement | null = null;
  let current = '';
  let draft = 0;

  /* ------------------------------------------------- rating, by the owner */

  function setDraft(r: number) {
    draft = Math.min(5, Math.max(0, Math.round(r * 2) / 2));
    const el = dialogBody.querySelector<HTMLElement>('[data-rate-stars]');
    const num = dialogBody.querySelector<HTMLInputElement>('[data-rate-num]');
    if (el) {
      el.style.setProperty('--r', String(draft));
      el.setAttribute('aria-valuenow', String(draft));
      el.setAttribute('aria-valuetext', draft ? `${draft} of 5` : 'Not rated');
    }
    if (num && document.activeElement !== num) num.value = draft ? String(draft) : '';
  }
  // A press or drag on the stars takes the half star under the pointer.
  const underPointer = (e: PointerEvent, el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    return Math.max(0.5, Math.ceil(((e.clientX - box.left) / box.width) * 10) / 2);
  };
  dialogBody.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-rate-stars]');
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    setDraft(underPointer(e, el));
    const move = (m: PointerEvent) => setDraft(underPointer(m, el));
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', () => el.removeEventListener('pointermove', move), { once: true });
  });
  dialogBody.addEventListener('keydown', (e) => {
    if (!(e.target as HTMLElement).matches('[data-rate-stars]')) return;
    const step = ({ ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 } as Record<string, number>)[e.key];
    if (step) setDraft(Math.max(0.5, draft + step));
    else if (e.key === 'Home') setDraft(0.5);
    else if (e.key === 'End') setDraft(5);
    else if (e.key === 'Delete' || e.key === 'Backspace') setDraft(0);
    else return;
    e.preventDefault();
  });
  dialogBody.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-rate-num]')) setDraft(t.value ? +t.value : 0);
  });
  dialogBody.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-rate-num]')) t.value = draft ? String(draft) : '';
  });
  dialogBody.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-rate-clear], [data-rate-save]');
    if (!t) return;
    if (t.hasAttribute('data-rate-clear')) return setDraft(0);
    void save(current, draft, dialogBody.querySelector<HTMLTextAreaElement>('[data-rate-review]')!.value);
  });

  /** Writes the rating and review into the book's file on GitHub, as the CMS
   *  would, then shows them here at once; the public page follows when the
   *  site rebuilds. */
  async function save(id: string, rating: number, review: string) {
    const b = books[id]!;
    const msg = dialogBody.querySelector<HTMLElement>('[data-rate-msg]')!;
    const btn = dialogBody.querySelector<HTMLButtonElement>('[data-rate-save]')!;
    btn.disabled = true;
    msg.textContent = 'Saving…';
    try {
      const url = `https://api.github.com/repos/${REPO}/contents/src/content/armarium/${encodeURIComponent(id)}.mdx`;
      const headers = { Authorization: `Bearer ${githubToken()}`, Accept: 'application/vnd.github+json' };
      const message = `Armarium: ${b.title}, ${rating ? `${rating} of 5` : 'rating cleared'}${review.trim() ? ', with a review' : ''}`;
      // Read the file fresh, and once more if it changed under us (a second save, or the CMS).
      for (let attempt = 0; ; attempt++) {
        const got = await fetch(`${url}?ref=${BRANCH}`, { headers, cache: 'no-store' });
        if (!got.ok) throw new Error(got.status === 401 ? 'the GitHub sign-in has expired; sign in at /admin again' : `GitHub answered ${got.status}`);
        const file = (await got.json()) as { content: string; sha: string };
        const content = toBase64(withRating(fromBase64(file.content), rating, review));
        const put = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ message, content, sha: file.sha, branch: BRANCH }) });
        if (put.ok) break;
        if (put.status !== 409 || attempt) throw new Error(`GitHub answered ${put.status}`);
      }
      b.rating = rating || null;
      b.review = review.trim() || null;
      search[id]![0] = hay(b);
      refreshCard(b);
      apply();
      const top = dialogBody.scrollTop;
      open(id);
      dialogBody.scrollTop = top;
      dialogBody.querySelector('[data-rate-msg]')!.textContent = 'Saved. Visitors will see it once the site rebuilds, in about four minutes.';
    } catch (err) {
      msg.textContent = `Not saved: ${(err as Error).message}.`;
      btn.disabled = false;
    }
  }

  function refreshCard(b: Book) {
    const card = cards.get(b.id)!;
    card.querySelector('.am-rating')?.remove();
    if (b.rating) card.querySelector('.am-a')!.insertAdjacentHTML('afterend', `<span class="am-rating">${stars(b.rating)} ${b.rating}</span>`);
    const btn = card.querySelector<HTMLElement>('[data-open]')!;
    btn.setAttribute('aria-label', btn.getAttribute('aria-label')!.replace(/, rated [\d.]+ of 5(?= — details$)|(?= — details$)/, b.rating ? `, rated ${b.rating} of 5` : ''));
  }

  dialog.addEventListener('close', () => {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    lastOpener?.focus();
  });
  // A click on the backdrop closes it, as a modal card should.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialogBody.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    const d = t.dataset;
    if (d.goBook) return open(d.goBook);
    const patch: Partial<State> | null =
      d.goAuthor ? { ...clearFilters(), author: d.goAuthor, sort: 'series' }
      : d.goSeries ? { ...clearFilters(), series: d.goSeries, sort: 'series' }
      : d.goShelf ? { ...clearFilters(), shelf: d.goShelf }
      : d.goPub ? { ...clearFilters(), pub: d.goPub }
      : null;
    if (patch) {
      dialog.close();
      set(patch, true);
    }
  });

  const clearFilters = (): Partial<State> => ({ q: '', shelf: '', lang: '', tr: '', author: '', pub: '', series: '', status: '', rate: '' });

  /* ---------------------------------------------------------- suggestions */

  // Everyone named on a book, with the Bangla spellings its credit line gives
  // them, so "হুমায়ূন" finds Humayun Ahmed. A Bangla name is kept only when
  // the book names one person in that role, so it can't land on the wrong one.
  const names = (s: string | null) => (s ?? '').split(/;|,|\s(?:and|&)\s|\s\/\s/).map((x) => x.trim()).filter(Boolean);
  const people = new Map<string, { name: string; bn: string[]; hay: string[]; author: number; tr: number }>();
  const seriesCount = new Map<string, number>();
  const bookHay: Record<string, [string[], string[]]> = {};
  for (const id of all) {
    const b = books[id]!;
    const credits = (b.creditBn ?? '').split(';').map((s) => s.trim());
    const bnAuthor = credits.find((s) => s && !s.includes(':'));
    const bnTr = credits.find((s) => s.startsWith('অনুবাদ'))?.split(':')[1]?.trim();
    const translators = names(b.translator);
    for (const [list, role, bn] of [[b.authors, 'author', bnAuthor], [translators, 'tr', bnTr]] as const) {
      for (const n of list) {
        const p = people.get(n) ?? { name: n, bn: [], hay: [fold(n)], author: 0, tr: 0 };
        p[role]++;
        if (bn && list.length === 1 && !p.bn.includes(bn)) { p.bn.push(bn); p.hay.push(fold(bn)); }
        people.set(n, p);
      }
    }
    if (b.series) seriesCount.set(b.series, (seriesCount.get(b.series) ?? 0) + 1);
    bookHay[id] = [
      [b.title, b.titleBn].filter(Boolean).map((s) => fold(s!)),
      [...b.authors, ...translators, ...names(b.editor), b.creditBn].filter(Boolean).map((s) => fold(s!)),
    ];
  }

  /** The label with the typed part marked, when folding kept its length. */
  const mark = (label: string, qq: string) => {
    const f = fold(label);
    const i = f.length === label.length ? f.indexOf(qq) : -1;
    return i < 0 ? esc(label) : `${esc(label.slice(0, i))}<mark>${esc(label.slice(i, i + qq.length))}</mark>${esc(label.slice(i + qq.length))}`;
  };
  const row = (main: string, sub: string, kind: string) =>
    `<span class="am-sg-main">${main}</span>${sub ? `<span class="am-sg-sub">${sub}</span>` : ''}<span class="am-sg-kind">${esc(kind)}</span>`;
  const plural = (n: number) => `${n} ${n === 1 ? 'book' : 'books'}`;

  interface Suggestion { s: number; kind: number; n: number; label: string; html: string; go: () => void }

  function suggestions(qq: string): Suggestion[] {
    const out: Suggestion[] = [];
    for (const p of people.values()) {
      const s = rank(qq, p.hay);
      if (s > 3) continue;
      const n = p.author + p.tr;
      const role = p.author && p.tr ? 'Author, translator' : p.author ? 'Author' : 'Translator';
      out.push({
        s, kind: 0, n, label: p.name,
        html: row(mark(p.name, qq), p.bn[0] ? `<span lang="bn">${mark(p.bn[0], qq)}</span>` : '', `${role} · ${plural(n)}`),
        // Authors have a filter of their own; a translator is found by name.
        go: () => set(p.author ? { ...clearFilters(), author: p.name, sort: 'series' } : { ...clearFilters(), q: p.name }, true),
      });
    }
    for (const [name, n] of seriesCount) {
      const s = rank(qq, [fold(name)]);
      if (s <= 3) out.push({ s, kind: 1, n, label: name, html: row(mark(name, qq), '', `Series · ${plural(n)}`), go: () => set({ ...clearFilters(), series: name, sort: 'series' }, true) });
    }
    for (const id of all) {
      const b = books[id]!;
      const [titles, credits] = bookHay[id]!;
      // A book whose title matches comes before one found by its author's name.
      const s = Math.min(rank(qq, titles), rank(qq, credits) + 4);
      if (s > 7) continue;
      const sub = [b.titleBn && b.titleBn !== b.title ? `<span lang="bn">${mark(b.titleBn, qq)}</span>` : '', esc(b.authors.join(', ') || (b.editor ? `ed. ${b.editor}` : ''))].filter(Boolean).join(' · ');
      out.push({ s, kind: 2, n: 0, label: b.title, html: row(mark(b.title, qq), sub, b.acc ? `No. ${b.acc}` : 'Book'), go: () => open(id, q) });
    }
    out.sort((a, b) => a.s - b.s || a.kind - b.kind || b.n - a.n || cmp(a.label, b.label));
    // At most six people, three series and twelve books.
    const room = [6, 3, 12];
    const kept = out.filter((x) => (room[x.kind] = room[x.kind]! - 1) >= 0);
    // Then everything the words match, which is what the shelf below shows.
    const terms = qq.split(/\s+/).filter(Boolean);
    const total = all.filter((id) => matches(books[id]!, terms)).length;
    if (total) {
      kept.push({ s: 9, kind: 3, n: total, label: '', html: `<span class="am-sg-main">See all ${plural(total)} matching</span>`, go: () => { q.blur(); results.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
    }
    return kept;
  }

  const listbox = tools.querySelector<HTMLUListElement>('[data-suggest]')!;
  let offered: Suggestion[] = [];
  let active = -1;

  function showSuggestions() {
    const qq = fold(q.value.trim());
    offered = qq ? suggestions(qq) : [];
    listbox.innerHTML = offered
      .map((x, i) => `<li role="option" id="am-sg-${i}" class="am-sg${x.kind === 3 ? ' am-sg-all' : ''}" aria-selected="false" data-i="${i}">${x.html}</li>`)
      .join('');
    listbox.hidden = !offered.length;
    q.setAttribute('aria-expanded', String(!listbox.hidden));
    setActive(-1);
  }
  function setActive(i: number) {
    listbox.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    active = i;
    const li = i >= 0 ? listbox.children[i] : null;
    if (li) {
      li.setAttribute('aria-selected', 'true');
      li.scrollIntoView({ block: 'nearest' });
      q.setAttribute('aria-activedescendant', li.id);
    } else q.removeAttribute('aria-activedescendant');
  }
  function hideSuggestions() {
    listbox.hidden = true;
    q.setAttribute('aria-expanded', 'false');
    setActive(-1);
  }
  function pick(i: number) {
    const x = offered[i];
    hideSuggestions();
    x?.go();
  }

  q.addEventListener('keydown', (e) => {
    if (listbox.hidden) {
      if (e.key === 'ArrowDown' && q.value.trim()) { e.preventDefault(); showSuggestions(); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = offered.length;
      setActive(e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) pick(active); else hideSuggestions();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideSuggestions();
    }
  });
  q.addEventListener('blur', hideSuggestions);
  // Keep the focus in the box while a suggestion is pressed, so blur doesn't
  // close the list before the click lands.
  listbox.addEventListener('mousedown', (e) => e.preventDefault());
  listbox.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (li) pick(Number(li.dataset.i));
  });

  /* ---------------------------------------------------------------- wiring */

  let timer = 0;
  q.addEventListener('input', () => {
    showSuggestions();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => set({ q: q.value }), 120);
  });
  for (const s of selects) s.addEventListener('change', () => set({ [s.name]: s.value } as Partial<State>));
  tools.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!t) return;
    if (t.dataset.shelfChip !== undefined) set({ shelf: t.dataset.shelfChip === state.shelf ? '' : t.dataset.shelfChip });
    if (t.dataset.view) set({ view: t.dataset.view });
    if (t.hasAttribute('data-reset')) set(clearFilters());
    if (t.hasAttribute('data-surprise') && shown.length) {
      open(shown[Math.floor(Math.random() * shown.length)]!.id, t);
    }
  });
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!t) return;
    if (t.dataset.open) return open(t.dataset.open, t);
    if (t.dataset.filterShelf) set({ ...clearFilters(), shelf: t.dataset.filterShelf }, true);
    if (t.dataset.filterLang) set({ ...clearFilters(), lang: t.dataset.filterLang }, true);
    if (t.dataset.filterAuthor) set({ ...clearFilters(), author: t.dataset.filterAuthor, sort: 'series' }, true);
    if (t.dataset.filterRate) set({ ...clearFilters(), rate: t.dataset.filterRate, sort: 'rating' }, true);
  });
  // "/" puts the cursor in the search box, as on most catalogues.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || dialog.open) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    e.preventDefault();
    q.focus();
  });

  syncControls();
  apply();
  const m = /^#book=(.+)$/.exec(location.hash);
  if (m) open(decodeURIComponent(m[1]!), cards.get(decodeURIComponent(m[1]!))?.querySelector('button'));
}

document.addEventListener('astro:page-load', init);
