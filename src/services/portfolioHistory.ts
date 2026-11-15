/**
 * What your Bitcoin was worth each day against what it cost you, for the
 * growth chart on the Portfolio tab.
 *
 * Holdings on each day come from the same average-cost rules as the Holdings
 * card (summariseHoldings), so the last point always matches it. Days before
 * the starting balance are left out: what you held then is not known, because
 * the starting balance is only a snapshot of its own date.
 */
import type { Currency, OHLCVCandle } from '../types';
import { summariseHoldings, isCoveredByOpening, type LivePrices, type OpeningPosition, type Trade } from './journal';

const DAY = 86400000;

export interface GrowthPoint {
  /** Open time of the daily bar. */
  day: number;
  /** BTC held at the end of that day. */
  btc: number;
  /** What it was worth at that day's close. */
  value: number;
  /** What it cost you (average cost of what you still held). */
  paidIn: number;
}

export const portfolioHistory = (
  trades: Trade[],
  opening: OpeningPosition | null,
  daily: OHLCVCandle[],
  currency: Currency,
  live: LivePrices
): GrowthPoint[] => {
  const counted = trades.filter((t) => !isCoveredByOpening(t, opening)).sort((a, b) => a.time - b.time);
  const starts = [...(opening ? [opening.time] : []), ...(counted[0] ? [counted[0].time] : [])];
  if (!starts.length) return [];
  const first = Math.min(...starts);

  const out: GrowthPoint[] = [];
  let k = 0;
  const upTo: Trade[] = [];
  for (const bar of daily) {
    const end = bar.time + DAY;
    if (end <= first || !(bar.close > 0)) continue;
    while (k < counted.length && counted[k]!.time < end) upTo.push(counted[k++]!);
    const s = summariseHoldings(upTo, currency, live, opening && opening.time < end ? opening : null);
    out.push({ day: bar.time, btc: s.btc, value: s.btc * bar.close, paidIn: s.costBasis });
  }
  return out;
};
