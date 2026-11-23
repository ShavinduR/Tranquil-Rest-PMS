/**
 * Guest phone numbers. Sri Lankan numbers are the default; foreign guests'
 * numbers must start with '+' (or '00') followed by the country code.
 *
 * Stored form (what goes in the database):
 *   Sri Lanka      → '0771234567'      (unchanged from earlier versions)
 *   International  → '+4915123456789'  (E.164: '+' and 8–15 digits)
 */
export type ParsedPhone = {
  kind: 'lk' | 'intl';
  /** Digits wa.me expects: country code + number, no '+' or spaces. */
  waDigits: string;
  stored: string;
  display: string;
};

const LK_NATIONAL = /^[1-9]\d{8}$/;

const parseLk = (national: string): ParsedPhone | null => {
  if (!LK_NATIONAL.test(national)) return null;
  const local = `0${national}`;
  return {
    kind: 'lk',
    waDigits: `94${national}`,
    stored: local,
    display: `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`,
  };
};

export const parsePhone = (input: string): ParsedPhone | null => {
  const trimmed = input.trim();
  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');

  if (international) {
    if (trimmed.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('94')) return parseLk(digits.slice(2));
    if (!/^[1-9]\d{7,14}$/.test(digits)) return null; // E.164: max 15 digits, no leading 0
    return { kind: 'intl', waDigits: digits, stored: `+${digits}`, display: `+${digits}` };
  }

  // No '+': only Sri Lankan forms are accepted, so foreign country codes are never guessed.
  if (digits.startsWith('94') && digits.length === 11) return parseLk(digits.slice(2));
  if (digits.startsWith('0') && digits.length === 10) return parseLk(digits.slice(1));
  if (digits.length === 9) return parseLk(digits);
  return null;
};

export const isValidPhone = (input: string): boolean => parsePhone(input) !== null;

/** Display form; falls back to what was typed if it cannot be parsed. */
export const formatPhone = (input: string): string => parsePhone(input)?.display ?? input;

/** @deprecated kept for older call sites: Sri Lankan numbers only, wa.me digits. */
export const normalizeLkPhone = (input: string): string | null => {
  const p = parsePhone(input);
  return p?.kind === 'lk' ? p.waDigits : null;
};

/** @deprecated use formatPhone */
export const formatLkPhone = formatPhone;
