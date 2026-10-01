import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OHLCVCandle } from '../types';
import { useData } from './DataContext';
import { useJournal } from './JournalContext';
import { fetchOHLCV } from '../services/api';
import { TIMEFRAME_MS } from '../services/candles';
import type { PriceSeries } from '../services/journal';
import {
  PAPER_KEY, PAPER_SETTINGS_KEY, EMPTY_BOOK, DEFAULT_PAPER_SETTINGS, parseBook, parsePaperSettings, toStored,
  parsePaperBackup, mergeBooks, checkOrder, filledLive, fillMarketPrices, fillOrder, recordBookAfter, hasDueAfter,
  deleteFromBook, change24h, change7d, adviceChangeFrom,
  type PaperBook, type PaperSettings, type PaperTrade, type PaperOrder, type PaperSkip, type PaperRestore,
} from '../services/paper';

const HOUR = TIMEFRAME_MS['1H'];
/** How often hourly prices are fetched again while an order is waiting. */
const RECHECK_MS = 10 * 60 * 1000;

interface PaperTradingValue {
  book: PaperBook;
  settings: PaperSettings;
  isLoaded: boolean;
  /** BTC/USD: hourly, then daily. For outcomes and fills. */
  usdSeries: PriceSeries[];
  /** BTC/USD change over the last 24 hours and 7 days, in %. */
  change24hPct: number | null;
  change7dPct: number | null;
  /** The advice tier changed in the last couple of days. */
  adviceChange: { from: string; to: string } | null;
  setSettings: (partial: Partial<PaperSettings>) => void;
  addTrade: (t: PaperTrade) => void;
  addSkip: (s: PaperSkip) => void;
  placeOrder: (o: PaperOrder) => void;
  cancelOrder: (id: string) => void;
  remove: (kind: 'trade' | 'order' | 'skip', id: string) => void;
  restore: (raw: string) => PaperRestore;
}

const PaperTradingContext = createContext<PaperTradingValue | null>(null);

export const usePaperTrading = (): PaperTradingValue => {
  const ctx = useContext(PaperTradingContext);
  if (!ctx) throw new Error('usePaperTrading must be inside PaperTradingProvider');
  return ctx;
};

/**
 * The paper record, kept apart from the real journal under its own storage
 * keys. Besides storing it, this does the two things that must happen
 * whether or not the paper screen is open: checking waiting limit orders for
 * a fill, and recording the price at each horizon after a decision once it
 * passes.
 */
export const PaperTradingProvider = ({ children }: { children: ReactNode }) => {
  const data = useData();
  const journal = useJournal();
  const [book, setBook] = useState<PaperBook>(EMPTY_BOOK);
  const [settings, setSettingsState] = useState<PaperSettings>(DEFAULT_PAPER_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [gbpHourly, setGbpHourly] = useState<OHLCVCandle[]>([]);
  const bookRef = useRef<PaperBook>(EMPTY_BOOK);
  const lastFetch = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const pairs = await AsyncStorage.multiGet([PAPER_KEY, PAPER_SETTINGS_KEY]);
        const stored = Object.fromEntries(pairs);
        bookRef.current = parseBook(stored[PAPER_KEY] ?? null);
        setBook(bookRef.current);
        setSettingsState(parsePaperSettings(stored[PAPER_SETTINGS_KEY] ?? null));
      } catch { /* start empty */ }
      setIsLoaded(true);
    })();
  }, []);

  /** Every change goes through here, so storage always matches what is on screen. */
  const update = useCallback((fn: (b: PaperBook) => PaperBook) => {
    const next = fn(bookRef.current);
    if (next === bookRef.current) return;
    bookRef.current = next;
    setBook(next);
    AsyncStorage.setItem(PAPER_KEY, JSON.stringify(toStored(next))).catch(() => {});
  }, []);

  const setSettings = useCallback((partial: Partial<PaperSettings>) => {
    setSettingsState((prev) => {
      const next = parsePaperSettings(JSON.stringify({ ...prev, ...partial }));
      AsyncStorage.setItem(PAPER_SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const usdHourly = data.ohlcv['1H'];
  const daily = data.ohlcv['1D'];
  const usdSeries = useMemo<PriceSeries[]>(
    () => [
      { candles: usdHourly, intervalMs: HOUR },
      { candles: daily, intervalMs: TIMEFRAME_MS['1D'] },
    ],
    [usdHourly, daily]
  );
  const gbpSeries = useMemo<PriceSeries[]>(() => [{ candles: gbpHourly, intervalMs: HOUR }], [gbpHourly]);

  const openOrders = book.orders.filter((o) => o.status === 'open');
  const hasOpen = openOrders.length > 0;

  // Hourly prices are what fills and outcomes are read from. Fetch them when
  // something is waiting on them, and again every few minutes while an order
  // is open, on the back of the app's own refresh.
  const { loadTimeframe, isLive, lastUpdated } = data;
  const lastHourly = usdHourly[usdHourly.length - 1]?.time ?? 0;
  useEffect(() => {
    if (!isLoaded || !isLive) return;
    const now = Date.now();
    const due = hasDueAfter(bookRef.current, now);
    if (!hasOpen && !due) return;
    const stale = !lastHourly || lastHourly + HOUR <= now;
    const recheck = hasOpen && now - lastFetch.current > RECHECK_MS;
    // A minute between attempts, so a failing source is not hammered.
    if ((!stale && !recheck) || now - lastFetch.current < 60 * 1000) return;
    lastFetch.current = now;
    loadTimeframe('1H');
    if (hasOpen) {
      fetchOHLCV('1H', 'GBP').then(setGbpHourly).catch(() => { /* checked again on the next refresh */ });
    }
  }, [isLoaded, isLive, lastUpdated, hasOpen, book, lastHourly, loadTimeframe]);

  // Check waiting orders against hourly prices, and against the live price
  // while the app is open.
  const livePrice = data.price;
  useEffect(() => {
    if (!isLoaded) return;
    const now = Date.now();
    const live = livePrice && livePrice.price > 0 && livePrice.price_gbp > 0 ? { usd: livePrice.price, gbp: livePrice.price_gbp } : null;
    update((b) => {
      let changed = false;
      const added: PaperTrade[] = [];
      const orders = b.orders.map((o) => {
        if (o.status !== 'open') return o;
        const candles = o.currency === 'GBP' ? gbpHourly : usdHourly;
        let r = checkOrder(o, candles, HOUR);
        if (r.kind === 'open' && isLive && live) {
          const seenAt = (livePrice?.last_updated ?? 0) * 1000;
          if (filledLive(o, o.currency === 'GBP' ? live.gbp : live.usd, seenAt)) r = { kind: 'filled', at: seenAt };
        }
        if (r.kind === 'open') return o;
        if (r.kind === 'filled') {
          const filled = fillOrder(o, r.at, fillMarketPrices(o, r.at, usdSeries, gbpSeries, live), now);
          // Only a real change counts: anything else would rewrite the book on every pass.
          if (!filled) return o;
          changed = true;
          added.push(filled.trade);
          return filled.order;
        }
        changed = true;
        if (r.kind === 'expired') return { ...o, status: 'expired' as const, closedAt: o.expiresAt, priceAtClose: r.priceAtClose };
        return { ...o, status: 'lapsed' as const, closedAt: now };
      });
      return changed ? mergeBooks({ ...b, orders }, { ...EMPTY_BOOK, trades: added }) : b;
    });
  }, [isLoaded, isLive, livePrice, usdHourly, gbpHourly, usdSeries, gbpSeries, book.orders, update]);

  // Record the price at each horizon once it has passed. Only from fresh
  // hourly prices: anything coarser recorded now would be frozen in for good.
  useEffect(() => {
    if (!isLoaded || !isLive || !usdHourly.length || lastHourly + 2 * HOUR < Date.now()) return;
    update((b) => recordBookAfter(b, usdSeries, Date.now()));
  }, [isLoaded, isLive, usdHourly, lastHourly, usdSeries, book, update]);

  const liveUsd = data.price?.price ?? null;
  const change24hPct = useMemo(() => change24h(usdHourly, liveUsd, Date.now()), [usdHourly, liveUsd]);
  const change7dPct = useMemo(() => change7d(daily, liveUsd, Date.now()), [daily, liveUsd]);
  const adviceChange = useMemo(() => adviceChangeFrom(journal.signalLog, Date.now()), [journal.signalLog]);

  const addTrade = useCallback((t: PaperTrade) => update((b) => mergeBooks(b, { ...EMPTY_BOOK, trades: [t] })), [update]);
  const addSkip = useCallback((s: PaperSkip) => update((b) => mergeBooks(b, { ...EMPTY_BOOK, skips: [s] })), [update]);
  const placeOrder = useCallback((o: PaperOrder) => update((b) => mergeBooks(b, { ...EMPTY_BOOK, orders: [o] })), [update]);
  const cancelOrder = useCallback(
    (id: string) => {
      const now = Date.now();
      update((b) => ({
        ...b,
        orders: b.orders.map((o) => {
          if (o.id !== id || o.status !== 'open') return o;
          const p = o.currency === 'GBP' ? data.price?.price_gbp : data.price?.price;
          return { ...o, status: 'cancelled' as const, closedAt: now, priceAtClose: p && p > 0 ? p : null };
        }),
      }));
    },
    [update, data.price]
  );
  const remove = useCallback((kind: 'trade' | 'order' | 'skip', id: string) => update((b) => deleteFromBook(b, kind, id)), [update]);

  const restore = useCallback(
    (raw: string) => {
      const r = parsePaperBackup(raw);
      if (!r.ok) return r;
      update((b) => mergeBooks(b, r.book));
      if (r.settings) setSettings(r.settings);
      return r;
    },
    [update, setSettings]
  );

  const value = useMemo<PaperTradingValue>(
    () => ({
      book, settings, isLoaded, usdSeries, change24hPct, change7dPct, adviceChange,
      setSettings, addTrade, addSkip, placeOrder, cancelOrder, remove, restore,
    }),
    [book, settings, isLoaded, usdSeries, change24hPct, change7dPct, adviceChange, setSettings, addTrade, addSkip, placeOrder, cancelOrder, remove, restore]
  );

  return <PaperTradingContext.Provider value={value}>{children}</PaperTradingContext.Provider>;
};
