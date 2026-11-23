/**
 * Normalises Sri Lankan numbers to the international form wa.me expects:
 * '077 123 4567' | '+94771234567' | '771234567' → '94771234567'.
 * Returns null when the number cannot be a valid LK number.
 */
export const normalizeLkPhone = (input: string): string | null => {
  const digits = input.replace(/\D/g, '');
  let national: string;
  if (digits.startsWith('94') && digits.length === 11) national = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 10) national = digits.slice(1);
  else if (digits.length === 9) national = digits;
  else return null;
  if (!/^[1-9]\d{8}$/.test(national)) return null;
  return `94${national}`;
};

export const isValidLkPhone = (input: string): boolean => normalizeLkPhone(input) !== null;

/** Display as '077 123 4567' */
export const formatLkPhone = (input: string): string => {
  const n = normalizeLkPhone(input);
  if (!n) return input;
  const local = `0${n.slice(2)}`;
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
};
