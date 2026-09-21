/**
 * Proof that a request came through Cloudflare Access.
 *
 * Access stands in front of /artifacts/private on asifuddin.com and turns away anyone
 * who is not signed in. That is the gate. This file exists because the gate
 * only covers the hostnames it was configured for: the same Worker also
 * answers on its workers.dev address and on preview URLs, where no Access
 * policy runs and a request would otherwise walk straight in.
 *
 * So the Worker does not trust the path, a cookie's presence, or a header's
 * presence. It checks the token Access signs for every request it lets
 * through — the signature against the team's published keys, the issuer, the
 * expiry, and the application it was issued for — and refuses everything
 * else. With Access misconfigured or missing, the answer is 401, never data.
 */

const KEY_TTL_MS = 60 * 60 * 1000;
/** A kid we have never seen triggers a refetch, but not more than this often. */
const MISS_COOLDOWN_MS = 60 * 1000;

const cache = { at: 0, missAt: 0, keys: new Map() };

function b64url(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const decode = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

function cookie(request, name) {
  const raw = request.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

async function loadKeys(url) {
  const res = await fetch(url, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error(`Access keys: ${res.status} from ${url}`);
  const { keys = [] } = await res.json();
  const out = new Map();
  for (const k of keys) {
    if (k.kty !== 'RSA' || !k.kid) continue;
    out.set(
      k.kid,
      await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    );
  }
  return out;
}

async function keyFor(env, kid) {
  const url = env.ACCESS_CERTS_URL || `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  const now = Date.now();
  const stale = now - cache.at > KEY_TTL_MS;
  // Access rotates its signing keys; an unknown kid is usually a new key, so
  // fetch again — but rate-limit it, or a forged kid becomes a way to make
  // this Worker hammer the certs endpoint.
  const missing = !cache.keys.has(kid) && now - cache.missAt > MISS_COOLDOWN_MS;
  if (stale || missing) {
    if (missing) cache.missAt = now;
    cache.keys = await loadKeys(url);
    cache.at = now;
  }
  return cache.keys.get(kid) ?? null;
}

/**
 * @returns {Promise<{ok: true, email: string} | {ok: false, reason: string}>}
 */
export async function verifyAccess(request, env) {
  const no = (reason) => ({ ok: false, reason });
  const auds = String(env.ACCESS_AUD ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!env.ACCESS_TEAM_DOMAIN || auds.length === 0) {
    return no('The Worker has no Access application configured (ACCESS_TEAM_DOMAIN, ACCESS_AUD).');
  }

  const token = request.headers.get('cf-access-jwt-assertion') || cookie(request, 'CF_Authorization');
  if (!token) {
    return no(
      'No Cloudflare Access sign-in reached this request. /artifacts/private has to be one of ' +
        'the paths on the Access application that already guards /vitae/cv/edit.',
    );
  }

  const parts = token.split('.');
  if (parts.length !== 3) return no('The Access token is malformed.');

  let header;
  let claims;
  try {
    header = decode(parts[0]);
    claims = decode(parts[1]);
  } catch {
    return no('The Access token is malformed.');
  }
  if (header.alg !== 'RS256') return no('The Access token uses an unexpected algorithm.');

  const key = await keyFor(env, header.kid);
  if (!key) return no('The Access token was signed by a key this team does not publish.');

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), signed);
  if (!valid) return no('The Access token signature does not verify.');

  const now = Date.now() / 1000;
  if (typeof claims.exp !== 'number' || claims.exp < now - 30) return no('The Access sign-in has expired.');
  if (typeof claims.nbf === 'number' && claims.nbf > now + 30) return no('The Access token is not valid yet.');
  if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return no('The Access token came from another team.');

  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some((a) => auds.includes(a))) {
    return no(
      'This sign-in belongs to a different Access application. Add /artifacts/private to the ' +
        'application that guards /vitae/cv/edit, or add this one\'s AUD tag to ACCESS_AUD.',
    );
  }

  return { ok: true, email: claims.email ?? claims.common_name ?? 'service token' };
}
