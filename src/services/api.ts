import { OHLCVCandle, FearGreedData, OnChainData, PriceData, Timeframe } from '../types';

import { Platform } from 'react-native';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const ALTERNATIVE_ME_BASE = 'https://api.alternative.me';
const MEMPOOL_BASE = 'https://mempool.space/api';

// On web, mempool.space blocks CORS. Use corsproxy.io as fallback.
const proxyUrl = (url: string): string => {
  if (Platform.OS === 'web' && url.includes('mempool.space')) {
    return `https://corsproxy.io/?${encodeURIComponent(url)}`;
  }
  return url;
};

const fetchJSON = async <T>(url: string, timeout = 15000): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const finalUrl = proxyUrl(url);
    const res = await fetch(finalUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
};

export const fetchPriceData = async (): Promise<PriceData> => {
  const [simple, detail] = await Promise.all([
    fetchJSON<Record<string, any>>(new URL('/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,gbp&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true', COINGECKO_BASE).toString()),
    fetchJSON<Record<string, any>>(new URL('/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false', COINGECKO_BASE).toString()),
  ]);
  const btc = simple?.bitcoin ?? {};
  const md = detail?.market_data ?? {};
  return {
    price: btc?.usd ?? 0,
    price_gbp: btc?.gbp ?? 0,
    market_cap: btc?.usd_market_cap ?? 0,
    volume_24h: btc?.usd_24h_vol ?? 0,
    change_24h: md?.price_change_24h ?? 0,
    change_24h_pct: btc?.usd_24h_change ?? 0,
    high_24h: md?.high_24h?.usd ?? 0,
    low_24h: md?.low_24h?.usd ?? 0,
    circulating_supply: md?.circulating_supply ?? 0,
    last_updated: btc?.last_updated_at ?? Date.now() / 1000,
  };
};

const TIMEFRAME_DAYS: Record<Timeframe, number> = {
  '1H': 1,
  '4H': 7,
  '1D': 30,
  '1W': 180,
};

export const fetchOHLCV = async (timeframe: Timeframe, currency: string = 'usd'): Promise<OHLCVCandle[]> => {
  const days = TIMEFRAME_DAYS[timeframe];
  const raw = await fetchJSON<number[][]>(new URL(`/api/v3/coins/bitcoin/ohlc?vs_currency=${currency}&days=${days}`, COINGECKO_BASE).toString());
  return (raw ?? []).map((c) => ({
    time: c?.[0] ?? 0,
    open: c?.[1] ?? 0,
    high: c?.[2] ?? 0,
    low: c?.[3] ?? 0,
    close: c?.[4] ?? 0,
  }));
};

export const fetchBTCDominance = async (): Promise<number> => {
  const data = await fetchJSON<Record<string, any>>(new URL('/api/v3/global', COINGECKO_BASE).toString());
  return data?.data?.market_cap_percentage?.btc ?? 0;
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
