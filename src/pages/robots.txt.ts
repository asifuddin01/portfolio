import type { APIRoute } from 'astro';
import { SITE } from '../consts';

/**
 * Generated rather than static, so the sitemap URL always matches the
 * configured domain. A hardcoded one silently pointed at the wrong host
 * after the domain changed.
 */
export const GET: APIRoute = () =>
  new Response(
    `User-agent: *
Allow: /
Disallow: /admin
Disallow: /uploads/
Disallow: /vitae/cv/edit

Sitemap: ${new URL('sitemap-index.xml', SITE).href}
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );
