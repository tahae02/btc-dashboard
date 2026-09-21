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
    try {
      const cur = currency?.toLowerCase() ?? 'usd';
      const results = await Promise.allSettled([
        fetchPriceData(),
        fetchOHLCV('1D', cur),
        fetchBTCDominance(),
        fetchFearGreed(),
        fetchOnChainData(),
      ]);
      if (!mountedRef.current) return;
      if (results[0].status === 'fulfilled') setPrice(results[0].value);
      if (results[1].status === 'fulfilled') setOhlcv(prev => ({ ...prev, '1D': results[1].status === 'fulfilled' ? results[1].value : prev['1D'] }));
      if (results[2].status === 'fulfilled') setBtcDominance(results[2].value);
      if (results[3].status === 'fulfilled') setFearGreed(results[3].value);
      if (results[4].status === 'fulfilled') setOnChain(results[4].value);

      const anyFailed = results.some(r => r.status === 'rejected');
      if (results.every(r => r.status === 'rejected')) {
        setError('Unable to fetch data. Check your connection.');
      } else if (anyFailed) {
        setError('Some data sources unavailable.');
      }
      setLastUpdated(new Date());
    } catch (e: any) {
      if (mountedRef.current) setError(e?.message ?? 'Unknown error');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
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
