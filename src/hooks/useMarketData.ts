import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MarketData, PriceData, OHLCVCandle, FearGreedData, OnChainData, Timeframe, RefreshInterval } from '../types';
import { fetchPriceData, fetchOHLCV, fetchBTCDominance, fetchFearGreed, fetchOnChainData } from '../services/api';
import { describeFetchError } from '../services/http';
import { SNAPSHOT_KEY, parseSnapshot, isFearGreedFresh, type Snapshot } from '../services/snapshot';
import { summariseRefresh, type ErrorKind, type SourceFailure } from '../services/sourceStatus';

const INTERVAL_MS: Record<RefreshInterval, number | null> = {
  manual: null,
  '1min': 60000,
  '5min': 300000,
};

const EMPTY_OHLCV: Record<Timeframe, OHLCVCandle[]> = { '1H': [], '4H': [], '1D': [], '1W': [] };
const EMPTY_ONCHAIN: OnChainData = { hashRate: 0, difficulty: null, mempool: null, fees: null };

export const useMarketData = (refreshInterval: RefreshInterval, signalTimeframe: Timeframe = '1D'): MarketData => {
  const [price, setPrice] = useState<PriceData | null>(null);
  const [ohlcv, setOhlcv] = useState<Record<Timeframe, OHLCVCandle[]>>(EMPTY_OHLCV);
  const [fearGreed, setFearGreed] = useState<FearGreedData | null>(null);
  const [onChain, setOnChain] = useState<OnChainData>(EMPTY_ONCHAIN);
  const [btcDominance, setBtcDominance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const mountedRef = useRef(true);

  // Mirror of the latest good values, for writing the snapshot and for
  // checks inside refresh() that must not wait on a re-render.
  const latest = useRef<Omit<Snapshot, 'savedAt'>>({
    price: null, timeframe: signalTimeframe, candles: [], fearGreed: null, btcDominance: null, onChain: null,
  });
  const hasLive = useRef(false);

  // Show the last saved data immediately on launch. Live results replace it as
  // they arrive; anything live that lands first is never overwritten by it.
  useEffect(() => {
    (async () => {
      let snap: Snapshot | null = null;
      try {
        snap = parseSnapshot(await AsyncStorage.getItem(SNAPSHOT_KEY));
      } catch { /* no snapshot, start from skeletons */ }
      if (!snap || !mountedRef.current) return;
      const l = latest.current;
      if (!l.price && snap.price) { l.price = snap.price; setPrice(snap.price); }
      if (!l.candles.length && snap.candles.length) {
        l.candles = snap.candles; l.timeframe = snap.timeframe;
        setOhlcv((prev) => (prev[snap.timeframe].length ? prev : { ...prev, [snap.timeframe]: snap.candles }));
      }
      if (!l.fearGreed && snap.fearGreed) { l.fearGreed = snap.fearGreed; setFearGreed(snap.fearGreed); }
      if (l.btcDominance == null && snap.btcDominance != null) { l.btcDominance = snap.btcDominance; setBtcDominance(snap.btcDominance); }
      if (!l.onChain && snap.onChain) { l.onChain = snap.onChain; setOnChain(snap.onChain); }
      if (!hasLive.current) setLastUpdated(new Date(snap.savedAt));
    })();
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);

    // Every source is requested at once and each result is shown the moment
    // it arrives. The previous version waited for ALL of them before showing
    // anything, so one slow or failing extra (Fear & Greed, on-chain) held the
    // whole Dashboard on skeletons for as long as its timeouts and retries
    // took, while the price had been sitting there since the first second.
    const alive = () => mountedRef.current;
    const pricePromise = fetchPriceData().then((v) => {
      if (!alive()) return;
      latest.current.price = v;
      hasLive.current = true;
      setPrice(v);
      setLastUpdated(new Date());
    });
    const ohlcPromise = fetchOHLCV(signalTimeframe).then((v) => {
      if (!alive()) return;
      latest.current.candles = v;
      latest.current.timeframe = signalTimeframe;
      setOhlcv((prev) => ({ ...prev, [signalTimeframe]: v }));
    });
    const domPromise = fetchBTCDominance().then((v) => {
      if (!alive()) return;
      latest.current.btcDominance = v;
      setBtcDominance(v);
    });
    const fgPromise = fetchFearGreed().then((v) => {
      if (!alive()) return;
      latest.current.fearGreed = v;
      setFearGreed(v);
    });
    const ocPromise = fetchOnChainData().then((v) => {
      if (!alive()) return;
      latest.current.onChain = v;
      setOnChain(v);
    });

    // Settled handlers are attached to everything up front so no rejection
    // is ever briefly unhandled.
    const corePromise = Promise.allSettled([pricePromise, ohlcPromise]);
    const extrasPromise = Promise.allSettled([domPromise, fgPromise, ocPromise]);

    // The pull-to-refresh spinner tracks what the app is for: price and
    // candles. The extras keep loading quietly behind it.
    const [priceRes, ohlcRes] = await corePromise;
    if (!alive()) return;
    setIsLoading(false);

    const [domRes, fgRes, ocRes] = await extrasPromise;
    if (!alive()) return;

    const failures: SourceFailure[] = [];
    const note = (res: PromiseSettledResult<unknown>, label: string) => {
      if (res.status === 'rejected') failures.push({ label, reason: describeFetchError(res.reason) });
    };
    note(priceRes, 'Live price (Kraken)');
    note(ohlcRes, 'Price history (Kraken)');
    note(domRes, 'BTC dominance (CoinPaprika)');
    // Fear & Greed is published once a day. If this refresh failed but the
    // reading on screen is still today's, what is shown is current and there
    // is nothing to warn about.
    if (!(fgRes.status === 'rejected' && isFearGreedFresh(latest.current.fearGreed))) {
      note(fgRes, 'Fear & Greed (Alternative.me)');
    }
    note(ocRes, 'On-chain (mempool.space)');

    const status = summariseRefresh(failures, priceRes.status === 'rejected' && ohlcRes.status === 'rejected');
    setFailedSources(failures.map((f) => f.label));
    setError(status.error);
    setErrorKind(status.errorKind);

    if (latest.current.price) {
      const snap: Snapshot = { savedAt: Date.now(), ...latest.current };
      AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap)).catch(() => {});
    }
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
    errorKind,
    failedSources,
    refresh: async () => { await refresh(); },
    loadTimeframe,
  };
};
