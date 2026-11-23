/** Letters/digits that can't be confused when read aloud or copied by hand (no 0/o, 1/l/i). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Easy-to-copy random password, e.g. 'k7pm-x3ra-9hvd' (12 random chars ≈ 59 bits). */
export const generatePassword = (rand: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))): string => {
  const values = rand(12);
  const chars = Array.from(values, (v) => ALPHABET[v % ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join('')).join('-');
};
