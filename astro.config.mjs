// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

import { SITE } from './src/consts.ts';

/**
 * Images dropped into a review through /admin are plain markdown, so they
 * miss the loading hints Astro's <Image> adds automatically.
 */
function rehypeImageDefaults() {
  return (tree) => {
    const walk = (node) => {
      if (node.type === 'element' && node.tagName === 'img') {
        node.properties = { loading: 'lazy', decoding: 'async', ...node.properties };
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
    rehypePlugins: [rehypeImageDefaults],
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [mdx(), sitemap()],
});
