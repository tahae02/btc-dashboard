/**
 * Every external URL the app calls, in one pure module.
 *
 * Kept free of React Native imports so the `probe` script and the tests can
 * exercise exactly the URLs the app ships with.
 *
 * URLs are built by plain string concatenation, deliberately. The previous
 * code used `new URL('/v1/fees/recommended', 'https://mempool.space/api')`,
 * and under the standard URL rules a path starting with `/` REPLACES the
 * base's path rather than appending to it, so `/api` was silently dropped.
 * Whether that bit depended on which URL implementation the runtime supplied,
 * which is not something a data layer should depend on.
 */
import type { Timeframe } from '../types';

export const KRAKEN_BASE = 'https://api.kraken.com/0/public';
export const PAPRIKA_BASE = 'https://api.coinpaprika.com/v1';
export const ALTERNATIVE_ME_BASE = 'https://api.alternative.me';
export const MEMPOOL_BASE = 'https://mempool.space/api';

/** Kraken OHLC interval in minutes per timeframe. Kraken returns up to 720 rows. */
export const KRAKEN_INTERVAL: Record<Timeframe, number> = {
  '1H': 60,
  '4H': 240,
  '1D': 1440,
  '1W': 10080,
};

export const ENDPOINTS = {
  ticker: `${KRAKEN_BASE}/Ticker?pair=XBTUSD,XBTGBP`,
  ohlc: (tf: Timeframe) => `${KRAKEN_BASE}/OHLC?pair=XBTUSD&interval=${KRAKEN_INTERVAL[tf]}`,
  dominance: `${PAPRIKA_BASE}/global`,
  fearGreed: `${ALTERNATIVE_ME_BASE}/fng/?limit=31&format=json`,
  hashrate: `${MEMPOOL_BASE}/v1/mining/hashrate/1m`,
  difficulty: `${MEMPOOL_BASE}/v1/difficulty-adjustment`,
  mempool: `${MEMPOOL_BASE}/mempool`,
  fees: `${MEMPOOL_BASE}/v1/fees/recommended`,
} as const;

/**
 * One entry per data source the app depends on: a human label for error
 * messages, the URL, and a check that the response actually contains what the
 * app reads. A 200 with an error body, or a reshaped payload, is a failure
 * too, and "HTTP 200" alone would hide it.
 */
export interface SourceCheck {
  key: string;
  label: string;
  url: string;
  /** Returns null when the body looks right, or a reason when it does not. */
  validate: (body: any) => string | null;
  /** Whether the app degrades or breaks without it. */
  essential: boolean;
}

const has = (cond: unknown, reason: string): string | null => (cond ? null : reason);

export const SOURCE_CHECKS: SourceCheck[] = [
  {
    key: 'ticker',
    label: 'Live price (Kraken)',
    url: ENDPOINTS.ticker,
    essential: true,
    validate: (b) =>
      Array.isArray(b?.error) && b.error.length
        ? `Kraken error: ${b.error.join(', ')}`
        : has(b?.result && Object.keys(b.result).length >= 1, 'no result pairs in response'),
  },
  {
    key: 'ohlc',
    label: 'Price history (Kraken)',
    url: ENDPOINTS.ohlc('1D'),
    essential: true,
    validate: (b) => {
      if (Array.isArray(b?.error) && b.error.length) return `Kraken error: ${b.error.join(', ')}`;
      const key = b?.result ? Object.keys(b.result).find((k) => k !== 'last') : undefined;
      const rows = key ? b.result[key] : null;
      return has(Array.isArray(rows) && rows.length > 200, `expected 200+ candles, got ${Array.isArray(rows) ? rows.length : 'none'}`);
    },
  },
  {
    key: 'dominance',
    label: 'BTC dominance (CoinPaprika)',
    url: ENDPOINTS.dominance,
    essential: false,
    validate: (b) =>
      has(typeof b?.bitcoin_dominance_percentage === 'number', 'no bitcoin_dominance_percentage field'),
  },
  {
    key: 'fearGreed',
    label: 'Fear & Greed (Alternative.me)',
    url: ENDPOINTS.fearGreed,
    essential: false,
    validate: (b) => has(Array.isArray(b?.data) && b.data.length > 0, 'no data array in response'),
  },
  {
    key: 'fees',
    label: 'On-chain fees (mempool.space)',
    url: ENDPOINTS.fees,
    essential: false,
    validate: (b) => has(typeof b?.fastestFee === 'number', 'no fastestFee field'),
  },
];
