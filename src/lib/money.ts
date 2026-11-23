const grouping = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** Sinhala UI: 'රු. 2,500' */
export const rupeesSi = (amount: number): string => `රු. ${grouping.format(Math.round(amount * 100) / 100)}`;

/** Admin UI: 'LKR 2,500' */
export const lkr = (amount: number): string => `LKR ${grouping.format(Math.round(amount * 100) / 100)}`;

export const plain = (amount: number): string => grouping.format(Math.round(amount * 100) / 100);

export const sum = (values: readonly number[]): number => values.reduce((acc, v) => acc + v, 0);
