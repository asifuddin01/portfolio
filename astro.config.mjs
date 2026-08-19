// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

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
  const DEMOTE = { h1: 'h2', h2: 'h3', h3: 'h4', h4: 'h5', h5: 'h6' };

  /** @param {HastNode} tree */
  return (tree) => {
    let sawH1 = false;
    /** @param {HastNode} node */
    const scan = (node) => {
      if (node.type === 'element' && node.tagName === 'h1') sawH1 = true;
      for (const child of node.children ?? []) scan(child);
    };
    scan(tree);

    /** @param {HastNode} node */
    const walk = (node) => {
      if (node.type === 'element') {
        if (node.tagName === 'img') {
          node.properties = { loading: 'lazy', decoding: 'async', ...node.properties };
        }
        const tag = node.tagName;
        if (sawH1 && tag && tag in DEMOTE) {
          node.tagName = DEMOTE[/** @type {keyof typeof DEMOTE} */ (tag)];
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

// https://astro.build/config
export default defineConfig({
  site: SITE,
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  markdown: {
    rehypePlugins: [rehypeProseDefaults],
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [mdx(), sitemap()],
});
