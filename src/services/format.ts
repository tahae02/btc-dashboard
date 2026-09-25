/**
 * Display formatting for the portfolio and track record.
 *
 * Dates are formatted by hand rather than with toLocaleString, whose output
 * differs between Hermes builds and devices.
 */
import type { Currency } from '../types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export const currencySymbol = (c: Currency): string => (c === 'GBP' ? '£' : '$');

/** "£1,234" for large amounts, "£12.34" below 100. */
export const formatMoney = (n: number, c: Currency, signed = false): string => {
  const abs = Math.abs(n);
  const digits = abs < 100 ? 2 : 0;
  const body = abs.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = n < 0 ? '-' : signed && n > 0 ? '+' : '';
  return `${sign}${currencySymbol(c)}${body}`;
};

/** Up to 8 decimals, trailing zeros trimmed: 0.00591700 -> "0.005917". */
export const formatBtc = (n: number): string => {
  const s = n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return s === '' ? '0' : s;
};

/**
 * Fraction to signed percent: 0.0213 -> "+2.1%". Anything that rounds to zero
 * is "0.0%", never "-0.0%".
 */
export const formatPct = (fraction: number, decimals = 1): string => {
  const text = (fraction * 100).toFixed(decimals);
  if (Number(text) === 0) return `${(0).toFixed(decimals)}%`;
  return `${fraction > 0 ? '+' : ''}${text}%`;
};

/** True when a fraction would display as 0.0%, so it should not be coloured as a gain or loss. */
export const isFlat = (fraction: number, decimals = 1): boolean => Number((fraction * 100).toFixed(decimals)) === 0;

/** Local "5 Mar 2026, 09:30". */
export const formatDateTime = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Local "5 Mar 2026". */
export const formatDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

/** Form defaults: local "YYYY-MM-DD" and "HH:MM". */
export const toDateInput = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const toTimeInput = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
