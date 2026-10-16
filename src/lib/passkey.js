/**
 * Six-digit passkeys for shared links. Imported by the Worker
 * (edge/share.js), which enforces the rule, and by the archive's page, which
 * applies it before asking and suggests codes that pass it.
 */

/**
 * Why a code is refused, or null. Refuses the codes anyone would try first,
 * so the five tries a link allows cannot be spent on 123456 and 000000 and
 * land: every AAAAAA, ABABAB and ABCABC, every straight run up or down, and
 * a few keypad shapes. About a thousandth of all codes.
 *
 * @param {string} code
 * @returns {string | null}
 */
export function weakPasskey(code) {
  if (!/^\d{6}$/.test(code)) return 'The passkey is six digits.';
  const d = [...code].map(Number);
  const steps = new Set(d.slice(1).map((x, i) => x - d[i]));
  const run = steps.size === 1 && Math.abs([...steps][0]) <= 1;
  const repeats = code.slice(0, 2).repeat(3) === code || code.slice(0, 3).repeat(2) === code;
  if (run || repeats || ['112233', '159753', '147258', '258369', '102030'].includes(code)) {
    return 'That passkey is one of the first anyone would try. Choose another, or take a new code.';
  }
  return null;
}

/**
 * A random code that passes. Drawn from the system's cryptographic source,
 * with values above the last whole million thrown back: 2³² is not a
 * multiple of a million, and plain modulo would favour the lower codes.
 *
 * @returns {string}
 */
export function newPasskey() {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] >= 4_294_000_000) continue;
    const code = String(buf[0] % 1_000_000).padStart(6, '0');
    if (!weakPasskey(code)) return code;
  }
}
