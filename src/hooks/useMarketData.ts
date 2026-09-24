import { useState, useEffect, useCallback, useRef } from 'react';
import type { MarketData, PriceData, OHLCVCandle, FearGreedData, OnChainData, Timeframe, RefreshInterval } from '../types';
import { fetchPriceData, fetchOHLCV, fetchBTCDominance, fetchFearGreed, fetchOnChainData } from '../services/api';

const INTERVAL_MS: Record<RefreshInterval, number | null> = {
  manual: null,
  '1min': 60000,
  '5min': 300000,
};

const EMPTY_OHLCV: Record<Timeframe, OHLCVCandle[]> = { '1H': [], '4H': [], '1D': [], '1W': [] };

export const useMarketData = (refreshInterval: RefreshInterval, signalTimeframe: Timeframe = '1D'): MarketData => {
  const [price, setPrice] = useState<PriceData | null>(null);
  const [ohlcv, setOhlcv] = useState<Record<Timeframe, OHLCVCandle[]>>(EMPTY_OHLCV);
  const [fearGreed, setFearGreed] = useState<FearGreedData | null>(null);
  const [onChain, setOnChain] = useState<OnChainData>({ hashRate: 0, difficulty: null, mempool: null, fees: null });
  const [btcDominance, setBtcDominance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // Fetched in parallel. The previous version ran these sequentially with
    // 350ms gaps to stay under CoinGecko's free-tier rate limit, but CoinGecko
    // is no longer used: Kraken, CoinPaprika and Alternative.me all tolerate
    // concurrent requests comfortably. The gaps were costing ~1.4s of startup
    // latency for a limit that no longer applies.
    const settled = await Promise.allSettled([
      fetchPriceData(),
      fetchOHLCV(signalTimeframe),
      fetchBTCDominance(),
      fetchFearGreed(),
      fetchOnChainData(),
    ]);

    if (!mountedRef.current) return;

    const [priceRes, ohlcRes, domRes, fgRes, ocRes] = settled;
    const failed: string[] = [];

    // Each failure is recorded by name. The previous banner said only "some
    // data sources are unavailable", which left no way to tell which one, or
    // whether pressing Retry could possibly help.
    if (priceRes.status === 'fulfilled') setPrice(priceRes.value); else failed.push('Live price (Kraken)');
    if (ohlcRes.status === 'fulfilled') setOhlcv((prev) => ({ ...prev, [signalTimeframe]: ohlcRes.value }));
    else failed.push('Price history (Kraken)');
    if (domRes.status === 'fulfilled') setBtcDominance(domRes.value); else failed.push('BTC dominance (CoinPaprika)');
    if (fgRes.status === 'fulfilled') setFearGreed(fgRes.value); else failed.push('Fear & Greed (Alternative.me)');
    if (ocRes.status === 'fulfilled') setOnChain(ocRes.value); else failed.push('On-chain (mempool.space)');

    setFailedSources(failed);

    // Price and candles are what the app is for. Losing dominance or sentiment
    // is a degraded view; losing the price is a broken one, so they are
    // reported differently rather than counted the same.
    const coreFailed = priceRes.status !== 'fulfilled' && ohlcRes.status !== 'fulfilled';
    if (coreFailed) {
      setError('Unable to fetch market data. Check your connection.');
    } else if (failed.length > 0) {
      const list = failed.length === 1 ? failed[0] : `${failed.slice(0, -1).join(', ')} and ${failed[failed.length - 1]}`;
      setError(
        `${list} ${failed.length === 1 ? 'is' : 'are'} unavailable. Everything else is live. ` +
          'If Retry keeps failing, that provider is down or blocking requests, not your connection.'
      );
    }

    setLastUpdated(new Date());
    setIsLoading(false);
  }, [signalTimeframe]);

  // Load a timeframe the chart asks for, on demand.
  const loadTimeframe = useCallback(async (tf: Timeframe) => {
    try {
      const data = await fetchOHLCV(tf);
      if (mountedRef.current) setOhlcv((prev) => ({ ...prev, [tf]: data }));
    } catch { /* the chart keeps showing whatever it already had */ }
  }, []);

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
    failedSources,
    refresh: async () => { await refresh(); },
    loadTimeframe,
  };
};
