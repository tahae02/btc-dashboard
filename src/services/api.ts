import type { OHLCVCandle, FearGreedData, OnChainData, PriceData, Timeframe } from '../types';
import { estimateCirculatingSupply } from './supply';

import { Platform } from 'react-native';

// Primary sources chosen for reliable browser CORS + generous free limits:
//  - Kraken:      live price + OHLC (both CORS-enabled, no key, high limits)
//  - CoinPaprika: BTC dominance
//  - Frankfurter: USD->GBP FX rate (for the GBP display toggle)
//  - Alternative.me: Fear & Greed Index
//  - mempool.space: on-chain metrics (native only; no browser CORS)
const KRAKEN_BASE = 'https://api.kraken.com/0/public';
const PAPRIKA_BASE = 'https://api.coinpaprika.com/v1';
const FX_BASE = 'https://api.frankfurter.app';
const ALTERNATIVE_ME_BASE = 'https://api.alternative.me';
const MEMPOOL_BASE = 'https://mempool.space/api';

// Kraken nests results under a pair key (e.g. "XXBTZUSD"); grab the first one.
const firstResult = <T>(result: Record<string, T> | undefined): T | undefined => {
  if (!result) return undefined;
  const keys = Object.keys(result).filter((k) => k !== 'last');
  return keys.length ? result[keys[0]] : undefined;
};

// Market cap is derived locally as price * supply; see services/supply.ts
// for why the supply figure is extrapolated rather than hardcoded.

// Kraken, CoinPaprika, Frankfurter and Alternative.me all send permissive CORS
// headers, so they are called directly on every platform. mempool.space does NOT
// allow browser CORS, so its calls are skipped on web (see IS_WEB gate in
// fetchOnChainData) and run only in the native app, where CORS does not apply.
export const IS_WEB = Platform.OS === 'web';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Short-lived cache + in-flight dedup so duplicate requests for the same URL
// (e.g. the Dashboard refresh and the Chart screen both wanting 1D OHLC) reuse
// a single network call instead of hitting the API twice.
const CACHE_TTL = 20000;
const cache = new Map<string, { ts: number; data: any }>();
const inflight = new Map<string, Promise<any>>();

const doFetch = async <T>(url: string, timeout: number): Promise<T> => {
  let lastErr: unknown = new Error('request failed');
  // Up to 3 attempts with backoff, to ride out a transient 429 or blip.
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (res.status === 429) {
        lastErr = new Error('HTTP 429');
        await sleep(1200 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(700 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
};

const fetchJSON = async <T>(url: string, timeout = 15000): Promise<T> => {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data as T;

  const existing = inflight.get(url);
  if (existing) return existing as Promise<T>;

  const p = doFetch<T>(url, timeout)
    .then((data) => {
      cache.set(url, { ts: Date.now(), data });
      return data;
    })
    .finally(() => {
      inflight.delete(url);
    });
  inflight.set(url, p);
  return p;
};

// Pick the Kraken result entry whose pair key contains the given quote currency.
const resultForQuote = (result: Record<string, any> | undefined, quote: string): Record<string, any> | undefined => {
  if (!result) return undefined;
  const key = Object.keys(result).find((k) => k !== 'last' && k.includes(quote));
  return key ? result[key] : undefined;
};

export const fetchPriceData = async (): Promise<PriceData> => {
  // Single Kraken ticker call for both USD and GBP pairs (no separate FX API).
  // Per pair: c=last, o=open(24h ago), h/l=[today,24h], v=vol(BTC), p=vwap.
  const data = await fetchJSON<Record<string, any>>(`${KRAKEN_BASE}/Ticker?pair=XBTUSD,XBTGBP`);
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

// Kraken OHLC interval in MINUTES per timeframe. Kraken returns up to 720 rows.
const TIMEFRAME_KRAKEN: Record<Timeframe, number> = {
  '1H': 60,
  '4H': 240,
  '1D': 1440,
  '1W': 10080,
};

export const fetchOHLCV = async (timeframe: Timeframe, _currency: string = 'usd'): Promise<OHLCVCandle[]> => {
  // Kraken OHLC (XBTUSD). Charts are always denominated in USD; the GBP toggle
  // only affects the headline price display, not the candle series.
  // Row shape: [time(s), open, high, low, close, vwap, volume, count].
  const interval = TIMEFRAME_KRAKEN[timeframe];
  const data = await fetchJSON<Record<string, any>>(`${KRAKEN_BASE}/OHLC?pair=XBTUSD&interval=${interval}`);
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
  const data = await fetchJSON<Record<string, any>>(`${PAPRIKA_BASE}/global`);
  return Number(data?.bitcoin_dominance_percentage ?? 0);
};

export const fetchFearGreed = async (): Promise<FearGreedData> => {
  const data = await fetchJSON<Record<string, any>>(new URL('/fng/?limit=31&format=json', ALTERNATIVE_ME_BASE).toString());
  const entries = data?.data ?? [];
  const current = entries?.[0] ?? { value: '50', value_classification: 'Neutral', timestamp: '0' };
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

export const fetchOnChainData = async (): Promise<OnChainData> => {
  // mempool.space does not send CORS headers, so browser fetches always fail.
  // Skip them on web (the On-Chain screen shows a "mobile app" notice) and run
  // them only in the native build where CORS restrictions do not apply.
  if (IS_WEB) {
    return { hashRate: 0, difficulty: null as any, mempool: null as any, fees: null as any };
  }
  const results = await Promise.allSettled([
    fetchJSON<Record<string, any>>(new URL('/v1/mining/hashrate/1m', MEMPOOL_BASE).toString()),
    fetchJSON<Record<string, any>>(new URL('/v1/difficulty-adjustment', MEMPOOL_BASE).toString()),
    fetchJSON<Record<string, any>>(new URL('/mempool', MEMPOOL_BASE).toString()),
    fetchJSON<Record<string, any>>(new URL('/v1/fees/recommended', MEMPOOL_BASE).toString()),
  ]);

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
