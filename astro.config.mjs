// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { SITE } from './src/consts.ts';
import { KATEX_MACROS } from './src/lib/katex-macros.ts';
import { runAllGuards } from './scripts/elementa/guards.mjs';

/**
 * @typedef {object} HastNode
 * @property {string} type
 * @property {string} [tagName]
 * @property {Record<string, unknown>} [properties]
 * @property {HastNode[]} [children]
 */

/**
 * Two fixes for prose written in /admin.
 *
 * 1. Images are plain markdown there, so they miss the loading hints
 *    astro:assets adds to component images.
 * 2. Every route already renders its own <h1> from the entry title. Typing
 *    "# Something" in the body is a natural thing to do and would put a
 *    second <h1> on the page, so body headings are demoted one level.
 */
function rehypeProseDefaults() {
  /**
   * Rewrite body headings so they descend one level at a time beneath the
   * page's own <h1>.
   *
   * Demoting each heading by a fixed step preserved whatever jumps the author
   * wrote: a body going "# A" then "### B" became h2 then h4, which is an
   * invalid outline. Tracking the previous depth means going deeper only ever
   * adds one, whatever the source did.
   */
  /** @param {HastNode} tree */
  return (tree) => {
    /** @type {HastNode[]} */
    const headings = [];

    /** @param {HastNode} node */
    const collect = (node) => {
      if (node.type === 'element') {
        if (node.tagName === 'img') {
          node.properties = { loading: 'lazy', decoding: 'async', ...node.properties };
        }
        if (node.tagName && /^h[1-6]$/.test(node.tagName)) headings.push(node);
      }
      for (const child of node.children ?? []) collect(child);
    };
    collect(tree);

    let prevSource = 0;
    let prevOutput = 1; // the page's own <h1>

    for (const node of headings) {
      const source = Number(String(node.tagName).slice(1));
      let output;
      if (source > prevSource) output = Math.min(prevOutput + 1, 6);
      else if (source === prevSource) output = prevOutput;
      else output = Math.max(2, prevOutput - (prevSource - source));
      node.tagName = `h${output}`;
      prevSource = source;
      prevOutput = output;
    }
  };
}

// https://astro.build/config
export default defineConfig({
  site: SITE,
  trailingSlash: 'never',
  /**
   * /codex was the long page's address for about a day before it became
   * /home. Short-lived, but it was live and linked, and a bookmark that
   * 404s is a worse outcome than a redirect nobody needs. Kept because it
   * costs one line; it can go once nothing points at it.
   */
  /**
   * Addresses people reach for that the site does not use.
   *
   * The CV lives under /vitae because it is part of the Vitae, but /cv is what
   * anybody types — it is what the PDF's own folder is called, and it is what
   * the author typed looking for the editor. A 404 there teaches nothing; the
   * redirect costs one hop and the address keeps working.
   *
   * /vitae/cv/edit stays behind Cloudflare Access either way. This fixes where
   * the door is, not who may open it.
   */
  redirects: {
    '/codex': '/home',
    '/cv': '/vitae/cv',
    '/cv/edit': '/vitae/cv/edit',
  },
  build: { inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  markdown: {
    // Astro 7 takes the pipeline as a processor; the old top-level
    // remarkPlugins/rehypePlugins keys are deprecated.
    //
    // KaTeX, not MathJax: server-rendered at build, zero client JS, no layout
    // shift. `strict: 'error'` means a malformed formula stops the build
    // instead of shipping as red text nobody notices (spec §5.8).
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [
        rehypeProseDefaults,
        [rehypeKatex, { macros: KATEX_MACROS, strict: 'error' }],
      ],
    }),
  },
  vite: {
    plugins: [
      tailwindcss(),
      /**
       * The C/C++ toolchain in /officina runs clang as WebAssembly across a
       * worker, which needs SharedArrayBuffer, which browsers only hand to a
       * cross-origin-isolated page. `require-corp` is safe to apply site-wide
       * here for the same reason the audit exists: every subresource this
       * site loads is already same-origin, so there is nothing left to block.
       * The deployed Worker sets the same pair on its own responses.
       *
       * `vite.server.headers` is ignored under `astro dev`, so the isolation
       * headers go on as middleware instead. Without them SharedArrayBuffer
       * is undefined and the toolchain refuses to start — in dev only; the
       * deployed Worker sets the same pair on its own responses.
       */
      {
        name: 'officina-cross-origin-isolation',
        configureServer(server) {
          server.middlewares.use((_req, res, next) => {
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
            next();
          });
        },
      },
    ],
    /**
     * The toolchain adapter imports its Python shim as `./subprocess_shim.py?raw`.
     * `?raw` is a Vite source-graph feature; the dependency pre-bundler runs
     * rolldown, which cannot resolve it and fails the whole optimize pass with
     * "No such file or directory" for a file that is right there. Serving these
     * two as source skips the pre-bundler and lets Vite handle `?raw` itself.
     */
    optimizeDeps: {
      exclude: ['@gameguild/emception-browser', 'emception'],
    },
  },
  integrations: [
    /**
     * The five Elementa guards (spec §12), wired as a build hook so a
     * structural violation fails `astro build` rather than a test suite
     * somebody remembers to run. Same philosophy as the plate embargo guard:
     * rules that depend on discipline are not rules.
     */
    {
      name: 'elementa-guards',
      hooks: {
        'astro:build:start': async ({ logger }) => {
          const results = await runAllGuards();
          const errors = results.flatMap((r) => r.errors);
          const owed = results.reduce((n, r) => n + r.warnings.length, 0);
          if (errors.length) {
            throw new Error(
              `\n\n  ELEMENTA — ${errors.length} violation(s) of the specification\n\n` +
              errors.map((e) => `   ✗ ${e}`).join('\n') +
              `\n\n  See §12. Run \`npm run check:elementa -- --verbose\` for the full picture.\n`
            );
          }
          logger.info(
            `seven guards pass · ${owed} outstanding obligation(s) across chapters still in review`
          );
        },
      },
    },
    mdx(),
    // The editor is noindex'd, but listing it in the sitemap invites crawlers
    // to it anyway.
    sitemap({
      filter: (page) => !page.includes('/admin') && !page.includes('/vitae/cv/edit'),
      // Match the canonical, slash-less form the links use.
      serialize: (item) => {
        // Strip the trailing slash so the sitemap names the same address the
        // links and canonicals do — but never reduce the root to a bare origin.
        const u = new URL(item.url);
        if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/$/, '');
        return { ...item, url: u.href };
      },
    }),
  ],
});
