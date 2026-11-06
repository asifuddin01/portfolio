import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';
import { AUTHOR } from '../consts';

/**
 * The web app manifest: what lets a browser offer to install the site as an
 * app (Brave's install icon in the address bar, "Add to Home Screen" on a
 * phone). Generated rather than static, so the name and description are the
 * ones the page itself carries and cannot drift from them.
 *
 * The icons are the favicon rendered to PNG (public/icon-*.png). Its four
 * marks sit inside the central circle a phone keeps when it crops an icon to
 * its own shape, so the same artwork also serves as the maskable icon.
 */
export const GET: APIRoute = async () => {
  const fp = await getEntry('site', 'frontispiece');
  const manifest = {
    name: AUTHOR,
    short_name: AUTHOR.replace(/^Md\.\s*/, ''),
    description: fp?.data.tagline ?? fp?.data.role ?? '',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#E7E1CE',
    theme_color: '#E7E1CE',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
};
