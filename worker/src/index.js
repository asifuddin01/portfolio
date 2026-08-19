/**
 * GitHub OAuth broker for the content manager.
 *
 * The CMS runs entirely in the browser and cannot hold a client secret, so
 * this Worker performs the code-for-token exchange server-side and hands the
 * token back to the opener window.
 *
 * Two routes:
 *   GET /auth      → redirect to GitHub's consent screen
 *   GET /callback  → exchange the code, post the token to the opener
 *
 * Secrets (set with `wrangler secret put`):
 *   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 * Vars (in wrangler.toml):
 *   ALLOWED_ORIGINS — comma-separated site origins allowed to receive a token
 */

const COOKIE = 'cms_oauth_state';

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
    },
  });
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The token is postMessage'd to a single, explicitly allowed origin. */
function closingPage(payload, targetOrigin) {
  const json = JSON.stringify(payload);
  return htmlResponse(`<!doctype html><meta charset="utf-8"><title>Signing in…</title>
<body><p>Completing sign-in…</p><script>
(function () {
  var message = 'authorization:github:${payload.token ? 'success' : 'error'}:' + ${JSON.stringify(json)};
  function send(e) {
    if (e.origin !== ${JSON.stringify(targetOrigin)}) return;
    if (e.data !== 'authorizing:github') return;
    window.removeEventListener('message', send);
    window.opener.postMessage(message, ${JSON.stringify(targetOrigin)});
  }
  window.addEventListener('message', send, false);
  if (window.opener) window.opener.postMessage('authorizing:github', ${JSON.stringify(targetOrigin)});
})();
</script></body>`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origins = allowedOrigins(env);

    if (url.pathname === '/auth') {
      const site = url.searchParams.get('site_id') ?? origins[0];
      if (!origins.includes(site)) {
        return htmlResponse('<h1>400</h1><p>That origin is not allowed to sign in.</p>', 400);
      }

      // Random state, mirrored in an HttpOnly cookie, defeats CSRF on the callback.
      const state = crypto.randomUUID();
      const authorize = new URL('https://github.com/login/oauth/authorize');
      authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      // `public_repo` is enough for a public repository and is the tighter
      // grant; set GITHUB_SCOPE=repo in wrangler.toml if yours is private.
      authorize.searchParams.set('scope', env.GITHUB_SCOPE ?? 'public_repo');
      authorize.searchParams.set('state', `${state}|${site}`);
      authorize.searchParams.set('redirect_uri', `${url.origin}/callback`);

      return new Response(null, {
        status: 302,
        headers: {
          Location: authorize.href,
          'Set-Cookie': `${COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
        },
      });
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const raw = url.searchParams.get('state') ?? '';
      const [state, site] = raw.split('|');

      const cookie = (request.headers.get('Cookie') ?? '')
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1);

      if (!code || !state || state !== cookie || !origins.includes(site)) {
        return htmlResponse('<h1>400</h1><p>Sign-in could not be verified. Try again.</p>', 400);
      }

      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${url.origin}/callback`,
        }),
      });

      const data = await res.json();
      if (!data.access_token) {
        return closingPage({ error: data.error_description ?? 'Token exchange failed' }, site);
      }
      return closingPage({ token: data.access_token, provider: 'github' }, site);
    }

    return htmlResponse('<h1>Codex auth</h1><p>Nothing to see here.</p>', 404);
  },
};
