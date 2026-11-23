/**
 * Offline PIN check, used only when the phone has no internet (to view the cached,
 * read-only data during a signal drop or power cut).
 *
 * After each successful ONLINE unlock we store a salted PBKDF2-SHA256 verifier
 * (210 000 iterations) instead of a plain hash, and a 4-digit PIN guessed offline
 * five times wrong deletes the verifier, so the phone must unlock online again.
 * Honest limit: a 4-digit PIN has only 10 000 values, so someone who copies the
 * browser's storage can still brute-force it; the cached snapshot itself is also
 * readable to them. The server-side lockout protects everything that matters online.
 */
export type PinVerifier = { v: 2; salt: string; iterations: number; hash: string };

export const PBKDF2_ITERATIONS = 210_000;

const b64 = (bytes: ArrayBuffer | Uint8Array): string => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  arr.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};
const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const derive = async (userId: string, pin: string, salt: Uint8Array, iterations: number): Promise<string> => {
  const saltBuf = salt.slice().buffer as ArrayBuffer;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${userId}:${pin}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBuf, iterations }, key, 256);
  return b64(bits);
};

export const createVerifier = async (userId: string, pin: string, iterations = PBKDF2_ITERATIONS): Promise<PinVerifier> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { v: 2, salt: b64(salt), iterations, hash: await derive(userId, pin, salt, iterations) };
};

export const checkVerifier = async (verifier: PinVerifier, userId: string, pin: string): Promise<boolean> =>
  verifier.v === 2 && (await derive(userId, pin, unb64(verifier.salt), verifier.iterations)) === verifier.hash;

export const parseVerifier = (raw: string | null): PinVerifier | null => {
  try {
    const v = JSON.parse(raw ?? 'null') as PinVerifier | null;
    return v && v.v === 2 && typeof v.hash === 'string' ? v : null;
  } catch {
    return null;
  }
};

export const MAX_OFFLINE_FAILURES = 5;
