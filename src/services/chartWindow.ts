/**
 * What the chart screen draws, worked out without React so it can be tested.
 *
 * ---------------------------------------------------------------------------
 * Why only a window of candles
 * ---------------------------------------------------------------------------
 * The chart once drew every candle Kraken returned (up to 720) into one SVG
 * about 5,760 points wide. On Android, react-native-svg renders a view into a
 * single bitmap sized in physical pixels, and Android kills the app outright
 * past a hard size limit. So the chart draws a screen's width of candles at a
 * time. Dragging sideways moves that window back through the history; it never
 * widens it. Indicators are still computed on the full history, which the
 * 200-period average needs; only the drawing is windowed.
 *
 * ---------------------------------------------------------------------------
 * Why the app draws its own candles
 * ---------------------------------------------------------------------------
 * The chart library used before (gifted-charts-core 0.1.82) called a candle
 * "bullish" when it OPENED above its close, which is a fall, so every rising
 * candle came out red and every falling one green. Drawing the candles here
 * puts the rule in one tested line (`candleIsUp`), and also lets the chart
 * show things the library could not: dates, round price labels, a pair of
 * Bollinger lines, and your own buys.
 */
import type { Currency, OHLCVCandle, Timeframe } from '../types';
import { currencySymbol } from './format';

/**
 * How many candles fit across the plot area, clamped so a narrow screen still
 * shows a meaningful stretch and a tablet does not bring back the huge bitmap.
 */
export const visibleCandleCount = (
  screenWidth: number,
  spacing: number,
  reservedWidth: number,
  min = 30,
  max = 90
): number => {
  const fit = Math.floor((screenWidth - reservedWidth) / spacing);
  return Math.max(min, Math.min(max, Number.isFinite(fit) ? fit : min));
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Up when it closed at or above where it opened. Green for up, red for down. */
export const candleIsUp = (c: Pick<OHLCVCandle, 'open' | 'close'>): boolean => c.close >= c.open;

export interface ChartLine {
  key: string;
  /** One value per drawn candle. */
  values: number[];
}

export interface ChartWindow {
  /** Candles to draw, oldest first, at their real prices. */
  candles: OHLCVCandle[];
  /** Overlay lines aligned one-to-one with `candles`. */
  lines: ChartLine[];
  /** Index into the full candle series where the window starts. */
  start: number;
  /** How many candles back from the latest the window ends (0 = up to date). */
  offset: number;
  /** Lowest and highest price among the candles and lines drawn. */
  lo: number;
  hi: number;
}

/** Keep the window inside the history: 0 is the latest candles, the most is the oldest full window. */
export const clampOffset = (n: number, count: number, offset: number): number => {
  const most = Math.max(0, n - Math.max(1, count));
  return Math.max(0, Math.min(most, Number.isFinite(offset) ? Math.round(offset) : 0));
};

/**
 * One overlay series sliced to the window. `raw` is index-aligned to the FULL
 * candle array, with NaN during its warm-up, and may be one shorter than the
 * candles: indicators skip the still-forming final bar, which the chart draws.
 * Gaps carry the previous value forward, seeded from before the window, so the
 * line never jumps in from nowhere or drops to zero.
 */
const sliceLine = (raw: number[], start: number, length: number): number[] | null => {
  let last: number | undefined;
  for (let i = Math.min(start, raw.length) - 1; i >= 0; i--) {
    if (isNum(raw[i])) { last = raw[i]; break; }
  }
  if (last === undefined) last = raw.slice(start, start + length).find(isNum);
  if (last === undefined) return null;
  let carry = last;
  return Array.from({ length }, (_, j) => {
    const v = raw[start + j];
    if (isNum(v)) carry = v;
    return carry;
  });
};

export const buildChartWindow = (
  candles: OHLCVCandle[],
  count: number,
  lines: Record<string, number[] | null | undefined> = {},
  offset = 0
): ChartWindow => {
  const n = candles.length;
  const off = clampOffset(n, count, offset);
  const end = n - off;
  const start = Math.max(0, end - Math.max(1, count));
  const slice = candles.slice(start, end);

  const out: ChartLine[] = [];
  for (const [key, raw] of Object.entries(lines)) {
    if (!raw || !raw.length) continue;
    const values = sliceLine(raw, start, slice.length);
    if (values) out.push({ key, values });
  }

  const prices = [
    ...slice.flatMap((c) => [c.low, c.high]).filter((v) => isNum(v) && v > 0),
    ...out.flatMap((l) => l.values).filter((v) => v > 0),
  ];
  return {
    candles: slice,
    lines: out,
    start,
    offset: off,
    lo: prices.length ? Math.min(...prices) : 0,
    hi: prices.length ? Math.max(...prices) : 0,
  };
};

// ===== Price axis =====

/** The next "round" step at or above `rough`: 1, 2, 2.5 or 5 times a power of ten. */
export const niceStep = (rough: number): number => {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= rough - 1e-9) return m * pow;
  }
  return 10 * pow;
};

export interface PriceScale {
  min: number;
  max: number;
  step: number;
  /** Round prices to label, lowest first. */
  ticks: number[];
}

/**
 * An axis whose labels land on round prices ($98k, $100k, $102k) rather than
 * wherever the data happens to start, with about `target` gaps between them.
 */
export const priceScale = (lo: number, hi: number, target = 4): PriceScale => {
  if (!isNum(lo) || !isNum(hi) || hi <= 0) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  let a = Math.min(lo, hi);
  let b = Math.max(lo, hi);
  if (b - a < b * 0.002) {
    // A flat window: give it a little room so it is not a single line.
    a -= b * 0.005;
    b += b * 0.005;
  }
  const step = niceStep((b - a) / Math.max(1, target));
  const min = Math.floor(a / step) * step;
  const max = Math.ceil(b / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 1e-6; v += step) ticks.push(+v.toFixed(6));
  return { min, max: max > min ? max : min + step, step, ticks };
};

/** Price label for the axis, as short as the step allows: "$98k", "$98.5k", "£950". */
export const formatAxisPrice = (n: number, step: number, currency: Currency = 'USD'): string => {
  if (!Number.isFinite(n)) return '';
  const sym = currencySymbol(currency);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(step >= 1e5 ? 1 : 2)}M`;
  if (abs >= 1e3) {
    const decimals = step >= 1000 ? 0 : step >= 100 ? 1 : 2;
    return `${sign}${sym}${(abs / 1e3).toFixed(decimals)}k`;
  }
  return `${sign}${sym}${abs.toFixed(step >= 1 ? 0 : 2)}`;
};

/** Compact price label for a narrow space: $112k, $61.5k, $950, $1.20M. */
export const formatPriceShort = (n: number, currency: Currency = 'USD'): string => {
  if (!Number.isFinite(n)) return '';
  const sym = currencySymbol(currency);
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sym}${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e5) return `${sym}${Math.round(n / 1e3)}k`;
  if (abs >= 1e3) return `${sym}${(n / 1e3).toFixed(1)}k`;
  return `${sym}${Math.round(n)}`;
};

// ===== Time axis =====

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Date label under a candle, local time, as much detail as the timeframe needs. */
export const formatCandleTime = (ms: number, tf: Timeframe): string => {
  const d = new Date(ms);
  if (tf === '1W') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (tf === '1D') return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Which candles get a date under them: `labels` of them, evenly spaced, kept
 * in from the edges so the text is not cut off.
 */
export const dateLabelIndexes = (count: number, labels = 4): number[] => {
  if (count <= 0) return [];
  if (count <= labels) return Array.from({ length: count }, (_, i) => i);
  const gap = count / labels;
  const out: number[] = [];
  for (let k = 0; k < labels; k++) out.push(Math.min(count - 1, Math.round(gap / 2 + k * gap)));
  return [...new Set(out)];
};

/** Index of the drawn candle a moment falls in, or -1 when it is outside the window. */
export const candleIndexAt = (candles: OHLCVCandle[], t: number, intervalMs: number): number => {
  if (!candles.length || t < candles[0]!.time || t >= candles[candles.length - 1]!.time + intervalMs) return -1;
  let lo = 0;
  let hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (candles[mid]!.time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};
