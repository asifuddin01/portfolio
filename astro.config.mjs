// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';

import { SITE } from './src/consts.ts';

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
  build: { inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  markdown: {
    // Astro 7 takes the pipeline as a processor; the old top-level
    // remarkPlugins/rehypePlugins keys are deprecated.
    processor: unified({ rehypePlugins: [rehypeProseDefaults] }),
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
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
