type Cell = string | number | null | undefined;

const escapeCell = (value: Cell): string => {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header: readonly string[], rows: readonly Cell[][]): string =>
  [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');

/** UTF-8 BOM makes Excel render Sinhala text correctly. */
export const downloadCsv = (filename: string, csv: string): void => {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
