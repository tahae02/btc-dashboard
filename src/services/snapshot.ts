/**
 * The last good set of market data, saved so the next launch can show it
 * straight away instead of a screen of skeletons.
 *
 * Pure (no storage calls) so the validation can be tested: whatever comes out
 * of storage may be from an older app version, truncated, or hand-edited, and
 * must never be able to put the screens into an impossible state.
 */
import type { PriceData, OHLCVCandle, FearGreedData, OnChainData, Timeframe } from '../types';

export const SNAPSHOT_KEY = 'btc_dashboard_snapshot_v1';

/**
 * Older than this and the snapshot is not shown at all. A week-old price with
 * a "168h ago" label is more misleading than helpful, and signals computed
 * from it would describe a market that has moved on.
 */
export const SNAPSHOT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Fear & Greed is a daily reading. If a refresh fails but the reading already
 * on screen is younger than this, it is still the current one, so there is
 * nothing to warn about.
 */
export const FEAR_GREED_FRESH_MS = 36 * 60 * 60 * 1000;

export interface Snapshot {
  savedAt: number;
  price: PriceData | null;
  timeframe: Timeframe;
  candles: OHLCVCandle[];
  fearGreed: FearGreedData | null;
  btcDominance: number | null;
  onChain: OnChainData | null;
}

const TIMEFRAMES: Timeframe[] = ['1H', '4H', '1D', '1W'];

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const validPrice = (p: any): PriceData | null =>
  p && isFiniteNum(p.price) && p.price > 0 && isFiniteNum(p.change_24h_pct) ? (p as PriceData) : null;

const validCandles = (c: unknown): OHLCVCandle[] =>
  Array.isArray(c) && c.every((k) => k && isFiniteNum(k.time) && isFiniteNum(k.close)) ? (c as OHLCVCandle[]) : [];

const validFearGreed = (f: any): FearGreedData | null =>
  f?.current && isFiniteNum(f.current.value) && Array.isArray(f.history) ? (f as FearGreedData) : null;

/** Parse a stored snapshot. Returns null if it is unusable or too old. */
export const parseSnapshot = (raw: string | null, now: number = Date.now()): Snapshot | null => {
  if (!raw) return null;
  let s: any;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!s || !isFiniteNum(s.savedAt) || now - s.savedAt > SNAPSHOT_MAX_AGE_MS || s.savedAt > now + 60000) return null;

  const price = validPrice(s.price);
  if (!price) return null; // nothing worth showing without a price

  return {
    savedAt: s.savedAt,
    price,
    timeframe: TIMEFRAMES.includes(s.timeframe) ? s.timeframe : '1D',
    candles: validCandles(s.candles),
    fearGreed: validFearGreed(s.fearGreed),
    btcDominance: isFiniteNum(s.btcDominance) ? s.btcDominance : null,
    onChain: s.onChain && typeof s.onChain === 'object' ? (s.onChain as OnChainData) : null,
  };
};

/** Whether a Fear & Greed reading is still today's (see FEAR_GREED_FRESH_MS). */
export const isFearGreedFresh = (fg: FearGreedData | null | undefined, now: number = Date.now()): boolean => {
  const ts = Number(fg?.current?.timestamp) * 1000;
  return Number.isFinite(ts) && ts > 0 && now - ts < FEAR_GREED_FRESH_MS;
};
