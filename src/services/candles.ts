/**
 * Candle hygiene.
 *
 * Exchanges return the CURRENT, still-forming bar as the last row of an OHLC
 * response. On a daily chart that bar is partial for 23 of every 24 hours, and
 * feeding it to the indicators quietly corrupts them:
 *
 *   - its volume is a fraction of a full day's, so a "volume spike" rule that
 *     compares the last bar to a 20-bar average can essentially never fire;
 *   - its high/low have not finished forming, so ATR under-reads volatility
 *     and support/resistance levels move around during the day;
 *   - every signal silently changes meaning depending on what time you open
 *     the app, which makes results impossible to reproduce or backtest.
 *
 * So indicators are computed on CLOSED bars only. The live price is still used
 * for display and for measuring distance to levels, where it is what you want.
 */
import type { OHLCVCandle, Timeframe } from '../types';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1H': 60 * 60 * 1000,
  '4H': 4 * 60 * 60 * 1000,
  '1D': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
};

/**
 * Drop the trailing bar when it has not closed yet.
 *
 * A bar stamped `time` covers `[time, time + duration)`, so it is closed once
 * `now >= time + duration`. Only the final bar is checked: earlier bars are
 * closed by construction.
 */
export const dropIncompleteCandle = (
  candles: OHLCVCandle[],
  timeframe: Timeframe,
  now: number = Date.now()
): OHLCVCandle[] => {
  if (!candles || candles.length === 0) return [];
  const duration = TIMEFRAME_MS[timeframe];
  if (!duration) return candles;
  const last = candles[candles.length - 1];
  if (!last || !last.time) return candles;
  return now < last.time + duration ? candles.slice(0, -1) : candles;
};

/** Ascending by timestamp, with duplicate timestamps collapsed (last wins). */
export const normaliseCandles = (candles: OHLCVCandle[]): OHLCVCandle[] => {
  const byTime = new Map<number, OHLCVCandle>();
  for (const c of candles) {
    if (!c || !Number.isFinite(c.time)) continue;
    if (!Number.isFinite(c.close) || c.close <= 0) continue;
    byTime.set(c.time, c);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
};
