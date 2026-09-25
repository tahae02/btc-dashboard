import type { OHLCVCandle, FearGreedData, FearGreedEntry, OnChainData, PriceData, Timeframe } from '../types';
import { estimateCirculatingSupply } from './supply';
import { ENDPOINTS } from './endpoints';
import { fetchJSON, FetchError, describeFetchError, type FetchOptions } from './http';

import { Platform } from 'react-native';

// Primary sources chosen for reliable browser CORS + generous free limits:
//  - Kraken:      live price in USD and GBP, plus OHLC (CORS-enabled, no key)
//  - CoinPaprika: BTC dominance
//  - Alternative.me: Fear & Greed Index
//  - mempool.space: on-chain metrics (native only; no browser CORS)
// URLs live in ./endpoints so the probe script and tests use exactly these.

// Kraken nests results under a pair key (e.g. "XXBTZUSD"); grab the first one.
const firstResult = <T>(result: Record<string, T> | undefined): T | undefined => {
  if (!result) return undefined;
  const keys = Object.keys(result).filter((k) => k !== 'last');
  return keys.length ? result[keys[0]] : undefined;
};

// Market cap is derived locally as price * supply; see services/supply.ts
// for why the supply figure is extrapolated rather than hardcoded.

// Kraken, CoinPaprika and Alternative.me all send permissive CORS
// headers, so they are called directly on every platform. mempool.space does NOT
// allow browser CORS, so its calls are skipped on web (see IS_WEB gate in
// fetchOnChainData) and run only in the native app, where CORS does not apply.
export const IS_WEB = Platform.OS === 'web';

// Price and candles are what the app is for, so they get the most patience.
// The rest are extras: they give up sooner and are not retried as hard, so a
// slow or blocking provider costs seconds rather than most of a minute. None
// of them hold up the screen either way, since results are shown as they
// arrive (see useMarketData).
const ESSENTIAL: FetchOptions = { timeout: 10000, attempts: 3 };
const EXTRA: FetchOptions = { timeout: 8000, attempts: 2 };

// Pick the Kraken result entry whose pair key contains the given quote currency.
const resultForQuote = (result: Record<string, any> | undefined, quote: string): Record<string, any> | undefined => {
  if (!result) return undefined;
  const key = Object.keys(result).find((k) => k !== 'last' && k.includes(quote));
  return key ? result[key] : undefined;
};

export const fetchPriceData = async (): Promise<PriceData> => {
  // Single Kraken ticker call for both USD and GBP pairs (no separate FX API).
  // Per pair: c=last, o=open(24h ago), h/l=[today,24h], v=vol(BTC), p=vwap.
  const data = await fetchJSON<Record<string, any>>(ENDPOINTS.ticker, ESSENTIAL);
  const usd = resultForQuote(data?.result, 'USD') ?? {};
  const gbp = resultForQuote(data?.result, 'GBP') ?? {};
  const price = Number(usd?.c?.[0] ?? 0);
  const open = Number(usd?.o ?? 0);
  const changeAbs = open ? price - open : 0;
  const changePct = open ? (changeAbs / open) * 100 : 0;
  const vol24hBtc = Number(usd?.v?.[1] ?? 0);
  const vwap24h = Number(usd?.p?.[1] ?? price);
  const priceGbp = Number(gbp?.c?.[0] ?? 0);
  return {
    price,
    price_gbp: priceGbp,
    market_cap: price * estimateCirculatingSupply(),
    volume_24h: vol24hBtc * vwap24h,
    change_24h: changeAbs,
    change_24h_pct: changePct,
    high_24h: Number(usd?.h?.[1] ?? 0),
    low_24h: Number(usd?.l?.[1] ?? 0),
    circulating_supply: estimateCirculatingSupply(),
    last_updated: Date.now() / 1000,
  };
};

export const fetchOHLCV = async (timeframe: Timeframe, quote: 'USD' | 'GBP' = 'USD'): Promise<OHLCVCandle[]> => {
  // Kraken OHLC. Charts and signals are always denominated in USD; the GBP
  // toggle only affects the headline price display. GBP candles are fetched
  // only to price back-dated trades logged in pounds.
  // Row shape: [time(s), open, high, low, close, vwap, volume, count].
  const data = await fetchJSON<Record<string, any>>(ENDPOINTS.ohlc(timeframe, quote), quote === 'USD' ? ESSENTIAL : EXTRA);
  const rows = firstResult<any[][]>(data?.result) ?? [];
  return rows.map((c) => ({
    time: Number(c?.[0] ?? 0) * 1000,
    open: Number(c?.[1] ?? 0),
    high: Number(c?.[2] ?? 0),
    low: Number(c?.[3] ?? 0),
    close: Number(c?.[4] ?? 0),
    volume: Number(c?.[6] ?? 0),
  }));
};

export const fetchBTCDominance = async (): Promise<number> => {
  // CoinPaprika global: BTC dominance %. CORS-enabled with generous free limits.
  const data = await fetchJSON<Record<string, any>>(ENDPOINTS.dominance, EXTRA);
  return Number(data?.bitcoin_dominance_percentage ?? 0);
};

export const fetchFearGreed = async (): Promise<FearGreedData> => {
  const data = await fetchJSON<Record<string, any>>(ENDPOINTS.fearGreed, EXTRA);
  const entries = Array.isArray(data?.data) ? data.data : [];
  // No reading is a failure, not a neutral 50: a made-up value would feed
  // straight into the signal as if it were real.
  if (!entries.length) throw new FetchError('bad response (no readings)');
  const current = entries[0];
  return {
    current: {
      value: Number(current?.value ?? 50),
      value_classification: current?.value_classification ?? 'Neutral',
      timestamp: current?.timestamp ?? '0',
    },
    history: (entries as any[]).map((e: any) => ({
      value: Number(e?.value ?? 50),
      value_classification: e?.value_classification ?? 'Neutral',
      timestamp: e?.timestamp ?? '0',
    })),
  };
};

/** Every Fear & Greed reading on record, newest first. */
export const fetchFearGreedHistory = async (): Promise<FearGreedEntry[]> => {
  const data = await fetchJSON<Record<string, any>>(ENDPOINTS.fearGreedHistory, EXTRA);
  const entries = Array.isArray(data?.data) ? data.data : [];
  return entries
    .map((e: any) => ({
      value: Number(e?.value),
      value_classification: String(e?.value_classification ?? ''),
      timestamp: String(e?.timestamp ?? ''),
    }))
    .filter((e: FearGreedEntry) => Number.isFinite(e.value) && Number(e.timestamp) > 0);
};

export const fetchOnChainData = async (): Promise<OnChainData> => {
  // mempool.space does not send CORS headers, so browser fetches always fail.
  // Skip them on web (the On-Chain screen shows a "mobile app" notice) and run
  // them only in the native build where CORS restrictions do not apply.
  if (IS_WEB) {
    return { hashRate: 0, difficulty: null as any, mempool: null as any, fees: null as any };
  }
  const results = await Promise.allSettled([
    fetchJSON<Record<string, any>>(ENDPOINTS.hashrate, EXTRA),
    fetchJSON<Record<string, any>>(ENDPOINTS.difficulty, EXTRA),
    fetchJSON<Record<string, any>>(ENDPOINTS.mempool, EXTRA),
    fetchJSON<Record<string, any>>(ENDPOINTS.fees, EXTRA),
  ]);

  // Partial failure is fine (the screen shows what it has), but if every
  // request failed, throw so the app reports on-chain as unavailable instead
  // of quietly rendering a screen of blanks.
  if (results.every((r) => r.status === 'rejected')) {
    const first = results[0] as PromiseRejectedResult;
    throw new FetchError(describeFetchError(first.reason));
  }

  const hashData = results[0].status === 'fulfilled' ? results[0].value : null;
  const diffData = results[1].status === 'fulfilled' ? results[1].value : null;
  const mempoolData = results[2].status === 'fulfilled' ? results[2].value : null;
  const feesData = results[3].status === 'fulfilled' ? results[3].value : null;

  // hashrate: last entry in currentHashrate array
  const hashArr = hashData?.currentHashrate ?? hashData?.hashrates ?? [];
  const lastHash = Array.isArray(hashArr) ? hashArr[hashArr.length - 1] : null;
  const hashRate = lastHash?.avgHashrate ?? 0;

  return {
    hashRate,
    difficulty: diffData as any,
    mempool: mempoolData as any,
    fees: feesData as any,
  };
};
