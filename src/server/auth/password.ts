/*
 * Password hashing with PBKDF2-SHA256 via WebCrypto. Better Auth's default
 * (scrypt in JS) costs far more CPU than a Worker on the free plan allows, and
 * WebCrypto PBKDF2 is native on every target. 100k iterations is the Workers max.
 * Format: pbkdf2_sha256$<iterations>$<salt b64>$<hash b64>
 */
const ITERATIONS = 100_000;
const enc = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return ['pbkdf2_sha256', String(ITERATIONS), toB64(salt), toB64(hash)].join('$');
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const [alg, iter, salt, expected] = hash.split('$');
  if (alg !== 'pbkdf2_sha256' || !iter || !salt || !expected) return false;
  const iterations = Number(iter);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
  const actual = await derive(password, fromB64(salt), iterations);
  return timingSafeEqual(actual, fromB64(expected));
}
