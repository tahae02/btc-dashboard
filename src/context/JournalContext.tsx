import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OHLCVCandle, SignalConfig, SignalResult } from '../types';
import { useData } from './DataContext';
import { useSettings } from './SettingsContext';
import { configFromSettings } from '../hooks/useSignalEngine';
import { computeIndicators } from '../services/indicators';
import { computeSignal } from '../services/signalEngine';
import { dropIncompleteCandle } from '../services/candles';
import {
  TRADES_KEY, OPENING_KEY, parseTrades, parseOpening, parseBackup, mergeTrades, sortTrades,
  type Trade, type SignalStamp, type OpeningPosition,
} from '../services/journal';
import { SIGNAL_LOG_KEY, REPLAY_WARMUP, parseSignalLog, appendToLog, stampFrom, type LoggedCall } from '../services/trackRecord';

const DAY = 24 * 60 * 60 * 1000;

interface JournalContextValue {
  trades: Trade[];
  /** Bitcoin already held before logging began. */
  opening: OpeningPosition | null;
  signalLog: LoggedCall[];
  isLoaded: boolean;
  /** Closed daily bars. The journal and track record always run on 1D. */
  closedDaily: OHLCVCandle[];
  /** Engine config with the user's settings applied. */
  config: SignalConfig;
  /** The daily signal right now, with the live price and Fear & Greed. */
  liveSignal: SignalResult | null;
  liveStamp: SignalStamp | null;
  addTrade: (t: Trade) => void;
  deleteTrade: (id: string) => void;
  setOpening: (o: OpeningPosition | null) => void;
  /** Merge a backup in. Returns how many trades it contained, and whether it had a starting balance. */
  restore: (raw: string) => { trades: number; opening: boolean };
}

const JournalContext = createContext<JournalContextValue | null>(null);

export const useJournal = (): JournalContextValue => {
  const ctx = useContext(JournalContext);
  if (!ctx) throw new Error('useJournal must be inside JournalProvider');
  return ctx;
};

const persist = (key: string, value: unknown) => {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
};

export const JournalProvider = ({ children }: { children: ReactNode }) => {
  const data = useData();
  const settings = useSettings();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [opening, setOpeningState] = useState<OpeningPosition | null>(null);
  const [signalLog, setSignalLog] = useState<LoggedCall[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const logRef = useRef<LoggedCall[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const pairs = await AsyncStorage.multiGet([TRADES_KEY, SIGNAL_LOG_KEY, OPENING_KEY]);
        const stored = Object.fromEntries(pairs);
        setTrades(parseTrades(stored[TRADES_KEY] ?? null));
        setOpeningState(parseOpening(stored[OPENING_KEY] ?? null));
        logRef.current = parseSignalLog(stored[SIGNAL_LOG_KEY] ?? null);
        setSignalLog(logRef.current);
      } catch { /* start empty */ }
      setIsLoaded(true);
    })();
  }, []);

  // Daily candles are fetched by the main refresh only when the signal
  // timeframe is 1D. On any other setting, fetch them here, and again when
  // what we hold has fallen more than a day behind.
  const daily = data.ohlcv['1D'];
  const lastDailyTime = daily[daily.length - 1]?.time ?? 0;
  const { loadTimeframe, isLive } = data;
  useEffect(() => {
    if (!isLive || settings.signalTimeframe === '1D') return;
    if (!lastDailyTime || Date.now() - lastDailyTime > DAY) loadTimeframe('1D');
  }, [isLive, data.lastUpdated, settings.signalTimeframe, lastDailyTime, loadTimeframe]);

  const { rsiOverbought, rsiOversold, stretchWeight } = settings;
  const config = useMemo(
    () => configFromSettings({ rsiOverbought, rsiOversold, stretchWeight }),
    [rsiOverbought, rsiOversold, stretchWeight]
  );
  const closedDaily = useMemo(() => dropIncompleteCandle(daily, '1D'), [daily]);
  const indicators = useMemo(() => computeIndicators(closedDaily), [closedDaily]);
  const livePrice = data.price?.price ?? 0;
  const fearGreed = data.fearGreed?.current?.value ?? null;
  const fearGreedLabel = data.fearGreed?.current?.value_classification ?? null;

  const liveSignal = useMemo(
    () =>
      closedDaily.length >= REPLAY_WARMUP && livePrice > 0
        ? computeSignal({ indicators, currentPrice: livePrice, fearGreed, config })
        : null,
    [closedDaily.length, indicators, livePrice, fearGreed, config]
  );

  const liveStamp = useMemo<SignalStamp | null>(
    () => (liveSignal ? stampFrom(liveSignal, indicators, fearGreed, fearGreedLabel, 'live') : null),
    [liveSignal, indicators, fearGreed, fearGreedLabel]
  );

  // Record today's call, once per closed daily bar. Only from live data: a
  // snapshot from a previous launch would log a stale call under today.
  const lastClosed = closedDaily[closedDaily.length - 1];
  useEffect(() => {
    if (!isLoaded || !isLive || !liveSignal || !lastClosed) return;
    // The last closed bar must be yesterday's, i.e. the candles are current.
    if (Date.now() - (lastClosed.time + DAY) > DAY) return;
    const next = appendToLog(logRef.current, {
      day: lastClosed.time,
      action: liveSignal.action,
      targetAllocation: liveSignal.targetAllocation,
      dcaMultiplier: liveSignal.dcaMultiplier,
      conviction: liveSignal.conviction,
      regimeScore: liveSignal.regimeScore,
      atr: indicators.atr,
      loggedAt: Date.now(),
      fearGreed,
    });
    if (next === logRef.current) return;
    logRef.current = next;
    setSignalLog(next);
    persist(SIGNAL_LOG_KEY, next);
  }, [isLoaded, isLive, liveSignal, lastClosed, indicators.atr, fearGreed]);

  const addTrade = useCallback((t: Trade) => {
    setTrades((prev) => {
      const next = sortTrades([...prev.filter((x) => x.id !== t.id), t]);
      persist(TRADES_KEY, next);
      return next;
    });
  }, []);

  const deleteTrade = useCallback((id: string) => {
    setTrades((prev) => {
      const next = prev.filter((t) => t.id !== id);
      persist(TRADES_KEY, next);
      return next;
    });
  }, []);

  const setOpening = useCallback((o: OpeningPosition | null) => {
    setOpeningState(o);
    if (o) persist(OPENING_KEY, o);
    else AsyncStorage.removeItem(OPENING_KEY).catch(() => {});
  }, []);

  const restore = useCallback(
    (raw: string) => {
      const backup = parseBackup(raw);
      if (backup.trades.length) {
        setTrades((prev) => {
          const next = mergeTrades(prev, backup.trades);
          persist(TRADES_KEY, next);
          return next;
        });
      }
      // A backup's starting balance replaces the current one: it describes
      // the same holdings, as they were when the backup was made.
      if (backup.opening) setOpening(backup.opening);
      return { trades: backup.trades.length, opening: backup.opening != null };
    },
    [setOpening]
  );

  const value = useMemo<JournalContextValue>(
    () => ({
      trades, opening, signalLog, isLoaded, closedDaily, config, liveSignal, liveStamp,
      addTrade, deleteTrade, setOpening, restore,
    }),
    [trades, opening, signalLog, isLoaded, closedDaily, config, liveSignal, liveStamp, addTrade, deleteTrade, setOpening, restore]
  );

  return <JournalContext.Provider value={value}>{children}</JournalContext.Provider>;
};
