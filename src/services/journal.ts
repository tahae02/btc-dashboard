/**
 * Trade journal: what you bought or sold, when, and what the signal said.
 *
 * Pure (no storage, no React) so every rule here is tested directly.
 *
 * Two things are deliberately frozen at the moment a trade is logged and never
 * recomputed later:
 *
 *   - the signal stamp, i.e. what the engine was actually saying. If the
 *     engine changes, old trades keep the call you acted on, not a rewrite of
 *     history by the new code;
 *   - the BTC/USD market price, which is what "what happened next" is
 *     measured from. It is kept separate from the price you paid, because
 *     your price includes fees and spread and the signal is not responsible
 *     for either.
 */
import type { Action, Currency, OHLCVCandle } from '../types';

export type TradeSide = 'buy' | 'sell';

/** What the engine said when a trade was made. */
export interface SignalStamp {
  action: Action;
  targetAllocation: number;
  dcaMultiplier: number;
  conviction: number;
  regimeScore: number;
  fearGreed: number | null;
  /**
   * 'live': what the app was showing when the trade was logged.
   * 'reconstructed': replayed from daily history for a back-dated trade, so
   * without Fear & Greed and on the day's close rather than the live price.
   */
  source: 'live' | 'reconstructed';
}

export interface Trade {
  id: string;
  side: TradeSide;
  /** When the trade happened, ms since epoch. */
  time: number;
  /** Spent on a buy, received on a sell. Fees included. */
  fiat: number;
  currency: Currency;
  /** Received on a buy, sent on a sell. Net of fees. */
  btc: number;
  /** BTC/USD market price at the time. Outcomes are measured from this. */
  marketPriceUsd: number | null;
  signal: SignalStamp | null;
  note: string;
  createdAt: number;
}

export const TRADES_KEY = 'btc_dashboard_trades_v1';

const DAY = 24 * 60 * 60 * 1000;
const ACTIONS: Action[] = ['ACCUMULATE_STRONG', 'ACCUMULATE', 'HOLD', 'REDUCE', 'EXIT'];
const CURRENCIES: Currency[] = ['USD', 'GBP'];
/** The genesis block. Nothing can have been bought before it. */
const EARLIEST = Date.UTC(2009, 0, 3);

const isPos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const makeId = (now: number = Date.now()): string =>
  `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ===== Storage validation =====

const parseStamp = (s: any): SignalStamp | null => {
  if (!s || !ACTIONS.includes(s.action)) return null;
  if (![s.targetAllocation, s.dcaMultiplier, s.conviction, s.regimeScore].every(isNum)) return null;
  return {
    action: s.action,
    targetAllocation: s.targetAllocation,
    dcaMultiplier: s.dcaMultiplier,
    conviction: s.conviction,
    regimeScore: s.regimeScore,
    fearGreed: isNum(s.fearGreed) ? s.fearGreed : null,
    source: s.source === 'live' ? 'live' : 'reconstructed',
  };
};

const parseTrade = (t: any): Trade | null => {
  if (!t || typeof t.id !== 'string' || !t.id) return null;
  if (t.side !== 'buy' && t.side !== 'sell') return null;
  if (!isNum(t.time) || t.time < EARLIEST) return null;
  if (!isPos(t.fiat) || !isPos(t.btc) || !CURRENCIES.includes(t.currency)) return null;
  return {
    id: t.id,
    side: t.side,
    time: t.time,
    fiat: t.fiat,
    currency: t.currency,
    btc: t.btc,
    marketPriceUsd: isPos(t.marketPriceUsd) ? t.marketPriceUsd : null,
    signal: parseStamp(t.signal),
    note: typeof t.note === 'string' ? t.note.slice(0, 500) : '',
    createdAt: isNum(t.createdAt) ? t.createdAt : t.time,
  };
};

/** Oldest first. Invalid entries are dropped rather than crashing a screen. */
export const sortTrades = (trades: Trade[]): Trade[] => [...trades].sort((a, b) => a.time - b.time || a.createdAt - b.createdAt);

/**
 * Parse stored trades, or a backup. Accepts the bare array the app stores and
 * the `{ app, version, trades }` wrapper that Export produces.
 */
export const parseTrades = (raw: string | null): Trade[] => {
  if (!raw) return [];
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.trades) ? data.trades : [];
  const seen = new Set<string>();
  const out: Trade[] = [];
  for (const item of list) {
    const t = parseTrade(item);
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  return sortTrades(out);
};

export const serialiseBackup = (trades: Trade[]): string =>
  JSON.stringify({ app: 'btc-analyst', version: 1, exportedAt: new Date().toISOString(), trades }, null, 1);

/** Merge a restored backup into the current list. Same id: the backup wins. */
export const mergeTrades = (current: Trade[], incoming: Trade[]): Trade[] => {
  const byId = new Map(current.map((t) => [t.id, t]));
  for (const t of incoming) byId.set(t.id, t);
  return sortTrades([...byId.values()]);
};

// ===== Form input =====

export interface TradeFormInput {
  side: TradeSide;
  /** 'YYYY-MM-DD', local time. */
  date: string;
  /** 'HH:MM', 24-hour, local time. */
  time: string;
  amount: string;
  currency: Currency;
  /** Optional. Blank means "work it out from the market price". */
  btc: string;
}

export type ParsedForm =
  | { ok: true; time: number; fiat: number; btc: number | null }
  | { ok: false; error: string };

/** Accepts "1,250.50", "£500" and "$ 20"; rejects anything else. */
export const parseAmount = (text: string): number | null => {
  const cleaned = text.trim().replace(/[£$,\s]/g, '');
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/** Local date and time from the form, or null if it is not a real moment. */
export const parseLocalDateTime = (date: string, time: string): number | null => {
  const d = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [h, mi] = [Number(t[1]), Number(t[2])];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const when = new Date(y, mo - 1, da, h, mi);
  // new Date rolls 31 February into March rather than failing; catch that.
  if (when.getFullYear() !== y || when.getMonth() !== mo - 1 || when.getDate() !== da) return null;
  return when.getTime();
};

export const parseTradeForm = (f: TradeFormInput, now: number = Date.now()): ParsedForm => {
  const time = parseLocalDateTime(f.date, f.time);
  if (time == null) return { ok: false, error: 'Enter the date as YYYY-MM-DD and the time as HH:MM.' };
  if (time > now + 5 * 60 * 1000) return { ok: false, error: 'That time is in the future.' };
  if (time < EARLIEST) return { ok: false, error: 'That is before Bitcoin existed.' };

  const fiat = parseAmount(f.amount);
  if (fiat == null || fiat <= 0) {
    return { ok: false, error: f.side === 'buy' ? 'Enter how much you spent.' : 'Enter how much you received.' };
  }

  if (!f.btc.trim()) return { ok: true, time, fiat, btc: null };
  const btc = parseAmount(f.btc);
  if (btc == null || btc <= 0) return { ok: false, error: 'Enter the BTC amount as a number, or leave it blank.' };
  if (btc > 21_000_000) return { ok: false, error: 'That is more Bitcoin than will ever exist.' };
  return { ok: true, time, fiat, btc };
};

// ===== Holdings =====

export interface LivePrices {
  usd: number;
  gbp: number;
}

export interface HoldingsSummary {
  btc: number;
  /** What the BTC you still hold cost, by the average-cost method. */
  costBasis: number;
  avgCost: number | null;
  value: number;
  unrealised: number;
  unrealisedPct: number | null;
  /** Profit or loss already locked in by sells. */
  realised: number;
  /** Total spent on buys. */
  invested: number;
  /** Some trades were in the other currency and converted at today's rate. */
  converted: boolean;
  /** More BTC was sold than was ever logged as bought. */
  oversold: boolean;
  buys: number;
  sells: number;
}

/** Convert between USD and GBP at today's BTC-implied rate. */
const convert = (amount: number, from: Currency, to: Currency, live: LivePrices): number => {
  if (from === to || !(live.usd > 0) || !(live.gbp > 0)) return amount;
  return from === 'USD' ? amount * (live.gbp / live.usd) : amount * (live.usd / live.gbp);
};

/**
 * Average-cost holdings, in `currency`.
 *
 * A sell removes cost at the running average, so realised P&L is the proceeds
 * minus what those coins cost on average. Trades in the other currency are
 * converted at today's rate, which is approximate, and flagged as such.
 */
export const summariseHoldings = (trades: Trade[], currency: Currency, live: LivePrices): HoldingsSummary => {
  let btc = 0;
  let cost = 0;
  let realised = 0;
  let invested = 0;
  let converted = false;
  let oversold = false;
  let buys = 0;
  let sells = 0;

  for (const t of sortTrades(trades)) {
    if (t.currency !== currency) converted = true;
    const fiat = convert(t.fiat, t.currency, currency, live);
    if (t.side === 'buy') {
      btc += t.btc;
      cost += fiat;
      invested += fiat;
      buys++;
    } else {
      sells++;
      const held = Math.max(0, btc);
      const sold = Math.min(t.btc, held);
      if (t.btc > held + 1e-12) oversold = true;
      const avg = held > 0 ? cost / held : 0;
      realised += fiat - avg * sold;
      cost -= avg * sold;
      btc -= t.btc;
    }
  }

  btc = Math.max(0, btc);
  if (btc < 1e-12) cost = 0;
  const price = currency === 'GBP' ? live.gbp : live.usd;
  const value = btc * price;
  const unrealised = value - cost;
  return {
    btc,
    costBasis: cost,
    avgCost: btc > 0 ? cost / btc : null,
    value,
    unrealised,
    unrealisedPct: cost > 0 ? (unrealised / cost) * 100 : null,
    realised,
    invested,
    converted,
    oversold,
    buys,
    sells,
  };
};

// ===== What happened next =====

export interface PriceSeries {
  candles: OHLCVCandle[];
  intervalMs: number;
}

/**
 * Market price at `t`: the close of the bar containing it, from the finest
 * series that covers it. Series are tried in the order given, so pass the
 * finest first (hourly, then daily). Null if no series covers `t`.
 */
export const priceAt = (t: number, series: PriceSeries[]): number | null => {
  for (const s of series) {
    const c = s.candles;
    if (!c.length || t < c[0]!.time || t >= c[c.length - 1]!.time + s.intervalMs) continue;
    // Last bar starting at or before t.
    let lo = 0;
    let hi = c.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (c[mid]!.time <= t) lo = mid;
      else hi = mid - 1;
    }
    const bar = c[lo]!;
    if (t < bar.time + s.intervalMs && bar.close > 0) return bar.close;
  }
  return null;
};

export const OUTCOME_HORIZONS = [
  { key: '1d', days: 1 },
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
] as const;

export interface TradeOutcome {
  key: string;
  days: number;
  /** When this horizon is reached. */
  due: number;
  /** Fractional BTC/USD change from the trade to the horizon; null if not yet known. */
  change: number | null;
  /** True if the move went your way: up after a buy, down after a sell. */
  favourable: boolean | null;
}

export const tradeOutcomes = (trade: Trade, series: PriceSeries[], now: number = Date.now()): TradeOutcome[] => {
  const entry = trade.marketPriceUsd ?? priceAt(trade.time, series);
  return OUTCOME_HORIZONS.map(({ key, days }) => {
    const due = trade.time + days * DAY;
    const later = due <= now && entry ? priceAt(due, series) : null;
    const change = later != null && entry ? later / entry - 1 : null;
    return {
      key,
      days,
      due,
      change,
      favourable: change == null ? null : trade.side === 'buy' ? change > 0 : change < 0,
    };
  });
};

// ===== Export =====

const csvCell = (v: string | number | null | undefined): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per trade, for a spreadsheet. */
export const tradesToCsv = (trades: Trade[]): string => {
  const header = [
    'date_utc', 'side', 'amount', 'currency', 'btc', 'price_paid', 'market_price_usd',
    'signal', 'dca_multiplier', 'conviction', 'target_allocation', 'signal_source', 'note',
  ];
  const rows = sortTrades(trades).map((t) =>
    [
      new Date(t.time).toISOString(),
      t.side,
      t.fiat,
      t.currency,
      t.btc,
      +(t.fiat / t.btc).toFixed(2),
      t.marketPriceUsd,
      t.signal?.action,
      t.signal?.dcaMultiplier,
      t.signal?.conviction,
      t.signal ? +t.signal.targetAllocation.toFixed(3) : null,
      t.signal?.source,
      t.note,
    ].map(csvCell).join(',')
  );
  return [header.join(','), ...rows].join('\n');
};

// ===== Your buys, grouped by the signal they were made on =====

export interface SignalGroup {
  action: Action;
  buys: number;
  /** Mean BTC/USD change after the buys whose horizon has passed. */
  after7d: { n: number; mean: number | null };
  after30d: { n: number; mean: number | null };
}

const TIER_ORDER: Action[] = ['ACCUMULATE_STRONG', 'ACCUMULATE', 'HOLD', 'REDUCE', 'EXIT'];

/**
 * Buys only: a sell's "good outcome" points the other way, and mixing the two
 * in one average would cancel out into nothing.
 */
export const groupBuysBySignal = (trades: Trade[], series: PriceSeries[], now: number = Date.now()): SignalGroup[] => {
  const acc = new Map<Action, { buys: number; s7: number; n7: number; s30: number; n30: number }>();
  for (const t of trades) {
    if (t.side !== 'buy' || !t.signal) continue;
    const g = acc.get(t.signal.action) ?? { buys: 0, s7: 0, n7: 0, s30: 0, n30: 0 };
    g.buys++;
    const outcomes = tradeOutcomes(t, series, now);
    const o7 = outcomes.find((o) => o.days === 7)?.change;
    const o30 = outcomes.find((o) => o.days === 30)?.change;
    if (o7 != null) { g.s7 += o7; g.n7++; }
    if (o30 != null) { g.s30 += o30; g.n30++; }
    acc.set(t.signal.action, g);
  }
  return TIER_ORDER.filter((a) => acc.has(a)).map((a) => {
    const g = acc.get(a)!;
    return {
      action: a,
      buys: g.buys,
      after7d: { n: g.n7, mean: g.n7 ? g.s7 / g.n7 : null },
      after30d: { n: g.n30, mean: g.n30 ? g.s30 / g.n30 : null },
    };
  });
};
