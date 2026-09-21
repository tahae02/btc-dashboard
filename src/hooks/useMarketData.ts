import { useState, useEffect, useCallback, useRef } from 'react';
import { MarketData, PriceData, OHLCVCandle, FearGreedData, OnChainData, Timeframe, RefreshInterval } from '../types';
import { fetchPriceData, fetchOHLCV, fetchBTCDominance, fetchFearGreed, fetchOnChainData } from '../services/api';

const INTERVAL_MS: Record<RefreshInterval, number | null> = {
  manual: null,
  '1min': 60000,
  '5min': 300000,
};

export const useMarketData = (refreshInterval: RefreshInterval, currency: string): MarketData => {
  const [price, setPrice] = useState<PriceData | null>(null);
  const [ohlcv, setOhlcv] = useState<Record<Timeframe, OHLCVCandle[]>>({ '1H': [], '4H': [], '1D': [], '1W': [] });
  const [fearGreed, setFearGreed] = useState<FearGreedData | null>(null);
  const [onChain, setOnChain] = useState<OnChainData>({ hashRate: 0, difficulty: null, mempool: null, fees: null });
  const [btcDominance, setBtcDominance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const cur = currency?.toLowerCase() ?? 'usd';
    const gap = () => new Promise(r => setTimeout(r, 350));
    // Fetch sequentially with small gaps so we never burst CoinGecko's free-tier
    // rate limit (parallel calls trigger 429s). The 1D OHLC fetched here is cached
    // so the Chart screen's own request reuses it instead of hitting the API again.
    const settle = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try { return await fn(); } catch { return undefined; }
    };

    let failures = 0;
    const total = 5;

    const priceRes = await settle(fetchPriceData);
    if (priceRes && mountedRef.current) setPrice(priceRes); else failures++;
    await gap();

    const ohlcRes = await settle(() => fetchOHLCV('1D', cur));
    if (ohlcRes && mountedRef.current) setOhlcv(prev => ({ ...prev, '1D': ohlcRes })); else failures++;
    await gap();

    const domRes = await settle(fetchBTCDominance);
    if (domRes != null && mountedRef.current) setBtcDominance(domRes); else failures++;
    await gap();

    const fgRes = await settle(fetchFearGreed);
    if (fgRes && mountedRef.current) setFearGreed(fgRes); else failures++;
    await gap();

    const ocRes = await settle(fetchOnChainData);
    if (ocRes && mountedRef.current) setOnChain(ocRes); else failures++;

    if (!mountedRef.current) return;
    if (failures >= total) setError('Unable to fetch data. Check your connection.');
    else if (failures > 0) setError('Some data sources unavailable.');
    setLastUpdated(new Date());
    setIsLoading(false);
  }, [currency]);

  // Load specific timeframe OHLCV on demand
  const loadTimeframe = useCallback(async (tf: Timeframe) => {
    try {
      const cur = currency?.toLowerCase() ?? 'usd';
      const data = await fetchOHLCV(tf, cur);
      if (mountedRef.current) setOhlcv(prev => ({ ...prev, [tf]: data }));
    } catch { /* ignore */ }
  }, [currency]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  useEffect(() => {
    const ms = INTERVAL_MS[refreshInterval];
    if (!ms) return;
    const id = setInterval(refresh, ms);
    return () => clearInterval(id);
  }, [refreshInterval, refresh]);

  return {
    price,
    ohlcv,
    fearGreed,
    onChain,
    btcDominance,
    isLoading,
    lastUpdated,
    error,
    refresh: async () => { await refresh(); },
    loadTimeframe,
  } as MarketData & { loadTimeframe: (tf: Timeframe) => Promise<void> };
};
