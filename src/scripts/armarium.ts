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
  notes: string[];
}

interface State {
  q: string; shelf: string; lang: string; tr: string; author: string; pub: string;
  series: string; status: string; sort: string; group: string; view: string;
}

const KEYS: (keyof State)[] = ['q', 'shelf', 'lang', 'tr', 'author', 'pub', 'series', 'status', 'sort', 'group', 'view'];
const DEFAULTS: State = { q: '', shelf: '', lang: '', tr: '', author: '', pub: '', series: '', status: '', sort: 'acc', group: '', view: 'covers' };

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

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
  for (const [id, p] of Object.entries(raw.books)) {
    const b = {
      acc: null, accEnd: null, volumes: 1, titleBn: null, series: null, seriesNo: null, author: null, authors: [],
      translator: null, editor: null, contributors: null, creditBn: null, category: null, categoryBn: null,
      translated: false, publisher: null, pub: null, description: null, cover: null, status: null, favourite: false,
      added: null, notes: [], ...p, id,
    } as Book;
    b.shelfNames = b.shelves.map((s) => shelves[s] ?? s);
    books[id] = b;
    const first = (b.author || b.editor || b.translator || '').split(/;|,|\sand\s/)[0]!.trim();
    const parts = first.replace(/\(.*?\)/g, '').trim().split(/\s+/);
    search[id] = [
      fold([b.title, b.titleBn, b.series, b.author, b.translator, b.editor, b.contributors, b.creditBn, b.category,
        b.categoryBn, b.publisher, b.description, b.language, b.acc, ...b.shelfNames].filter(Boolean).join(' ')),
      `${parts.at(-1) ?? ''} ${first}`.toLowerCase(),
    ];
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
    return true;
  };

  const sorters: Record<string, (a: Book, b: Book) => number> = {
    acc: (a, b) => (a.acc ?? 1e9) - (b.acc ?? 1e9) || cmp(a.title, b.title),
    title: (a, b) => cmp(a.title, b.title),
    author: (a, b) => cmp(search[a.id]![1], search[b.id]![1]) || cmp(a.series ?? '', b.series ?? '') || (a.seriesNo ?? 0) - (b.seriesNo ?? 0) || cmp(a.title, b.title),
    series: (a, b) => (a.series ? 0 : 1) - (b.series ? 0 : 1) || cmp(a.series ?? '', b.series ?? '') || (a.seriesNo ?? 0) - (b.seriesNo ?? 0) || cmp(a.title, b.title),
    added: (a, b) => cmp(b.added ?? '', a.added ?? '') || (b.acc ?? 0) - (a.acc ?? 0),
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
        ${b.notes.length ? `<div class="am-d-notes">${b.notes.map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : ''}
        ${sameSeries.length > 1 ? `<div class="am-d-more"><p class="am-d-k">In this series</p><ol>${sameSeries.map((x) => `<li>${x.id === id ? `<strong>${esc(x.title)}</strong>` : `<button type="button" class="am-linkish" data-go-book="${esc(x.id)}">${esc(x.title)}</button>`}</li>`).join('')}</ol></div>` : ''}
        ${!b.series && sameAuthor.length ? `<div class="am-d-more"><p class="am-d-k">More by ${esc(b.authors[0])}</p><ul>${sameAuthor.map((x) => `<li><button type="button" class="am-linkish" data-go-book="${esc(x.id)}">${esc(x.title)}</button></li>`).join('')}</ul></div>` : ''}
        <p class="am-owner am-d-edit"><a class="link" href="/admin/#/collections/armarium/entries/${esc(id)}">Edit this book</a></p>
      </div>`;
    const img = dialogBody.querySelector('img');
    if (img) { img.alt = b.coverAlt; img.loading = 'eager'; }
    if (!dialog.open) {
      lastOpener = opener ?? lastOpener;
      dialog.showModal();
    }
    dialogBody.scrollTop = 0;
    history.replaceState(history.state, '', `${location.pathname}${location.search}#book=${encodeURIComponent(id)}`);
  }
  let lastOpener: HTMLElement | null = null;

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

  const clearFilters = (): Partial<State> => ({ q: '', shelf: '', lang: '', tr: '', author: '', pub: '', series: '', status: '' });

  /* ---------------------------------------------------------------- wiring */

  let timer = 0;
  q.addEventListener('input', () => {
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
