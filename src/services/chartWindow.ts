/**
 * What the chart screen actually draws.
 *
 * ---------------------------------------------------------------------------
 * Why only a window of candles
 * ---------------------------------------------------------------------------
 * The chart used to draw every candle Kraken returned (up to 720) at 8 points
 * apart, making one SVG roughly 5,760 points wide. On Android, react-native-svg
 * renders a view into a single bitmap sized in physical pixels, and Android
 * refuses to draw bitmaps past a hard size limit: the app is killed outright,
 * with no JavaScript error to catch. That matches the reported symptom exactly,
 * a hard close only on the chart tab. Nobody can read 720 candles on a phone
 * anyway, so the chart now draws the most recent candles that fit the screen.
 * Indicators are still computed on the full history, which the 200-period
 * average needs; only the drawing is windowed.
 *
 * ---------------------------------------------------------------------------
 * Why prices are shifted before drawing
 * ---------------------------------------------------------------------------
 * The chart's y-axis starts at zero. With Bitcoin near six figures and a
 * window spanning perhaps 15%, every candle would be squashed into a thin band
 * at the top. Rather than depend on the library's offset option, whose exact
 * semantics could not be checked here, prices are shifted down by a base and
 * the base is added back when the axis labels are formatted. That relies only
 * on the default zero-based axis, which is certain.
 */
import type { OHLCVCandle } from '../types';

export interface ChartCandle {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartWindow {
  /** Candles to draw, already shifted down by `base`. */
  candles: ChartCandle[];
  /** Overlay line aligned one-to-one with `candles`, shifted by `base`, or null. */
  overlay: { value: number }[] | null;
  /** Amount subtracted from every price. Add it back for display. */
  base: number;
  /** Index into the full candle series where the window starts. */
  start: number;
}

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

/**
 * Slice the most recent `count` candles and align an optional overlay series.
 *
 * `overlayRaw` is index-aligned to the FULL candle array, with NaN during its
 * warm-up. It may be one shorter than the candles: indicators skip the
 * still-forming final bar, while the chart deliberately draws it. Gaps carry
 * the previous value forward so the line never drops to zero, which would
 * drag the axis down and flatten the candles.
 */
export const buildChartWindow = (
  candles: OHLCVCandle[],
  count: number,
  overlayRaw: number[] | null = null
): ChartWindow => {
  const n = candles.length;
  const start = Math.max(0, n - Math.max(1, count));
  const slice = candles.slice(start);

  let overlayAbs: number[] | null = null;
  if (overlayRaw && overlayRaw.length) {
    // Seed with the last valid value before the window, so the line starts at
    // the right level rather than jumping in from the first valid point.
    let last: number | undefined;
    for (let i = Math.min(start, overlayRaw.length) - 1; i >= 0; i--) {
      if (isNum(overlayRaw[i])) { last = overlayRaw[i]; break; }
    }
    if (last === undefined) {
      last = overlayRaw.slice(start).find(isNum);
    }
    if (last !== undefined) {
      let carry = last;
      overlayAbs = slice.map((_, j) => {
        const v = overlayRaw[start + j];
        if (isNum(v)) carry = v;
        return carry;
      });
    }
  }

  // Base sits a little below the lowest thing drawn, candles or overlay, so
  // nothing is shifted below zero.
  const lows = slice.map((c) => c.low).filter(isNum);
  const candidates = overlayAbs ? [...lows, ...overlayAbs] : lows;
  const floor = candidates.length ? Math.min(...candidates) : 0;
  const base = floor > 0 ? Math.floor(floor * 0.98) : 0;

  return {
    candles: slice.map((c) => ({
      open: (c.open ?? 0) - base,
      high: (c.high ?? 0) - base,
      low: (c.low ?? 0) - base,
      close: (c.close ?? 0) - base,
    })),
    overlay: overlayAbs ? overlayAbs.map((v) => ({ value: v - base })) : null,
    base,
    start,
  };
};

/** Compact price label for a narrow y-axis: $112k, $61.5k, $950, $1.20M. */
export const formatPriceShort = (n: number): string => {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e5) return `$${Math.round(n / 1e3)}k`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${Math.round(n)}`;
};
