/** PIN hashing with PBKDF2-SHA256 (WebCrypto: available in Electron main, Node 24 and browsers). */
const ITERATIONS = 120_000;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [alg, it, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2' || !it || !salt || !hash) return false;
  const calc = await derive(pin, unb64(salt), Number(it));
  const expected = unb64(hash);
  if (calc.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < calc.length; i++) diff |= (calc[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0;
}

export function uuid(): string { return crypto.randomUUID(); }
