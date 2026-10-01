/**
 * Paper trading: buys, sells and limit orders made with no real money, kept
 * entirely apart from the real journal.
 *
 * Pure (no storage, no React) so every rule here is tested directly.
 *
 * What it is for
 * --------------
 * With real money you follow the advice loosely. With paper money you can
 * follow it to the letter, every time, and see what that would have done. Each
 * paper decision records the same full picture as a real trade (the signal
 * stamp, the market in pounds and dollars) plus what the decision was acting
 * on: whose advice, why now, what the app suggested, and, for Claude's
 * /btc-brief, its verdict and the chances it gave. That makes the log a data
 * bank to judge the advice by later.
 *
 * Three kinds of decision are kept:
 *
 *   - trades: a paper buy or sell at the live price. Always "now": a paper
 *     trade back-dated after the fact would be chosen with hindsight, which
 *     is exactly the bias a record like this exists to avoid;
 *   - limit orders: "buy if the price comes down to X before Y", the way
 *     /btc-brief suggests splitting a buy. Fills are worked out from hourly
 *     candles, so the order fills (or not) whether or not the app is open;
 *   - skips: a deliberate decision not to buy, for when the advice says wait
 *     or stand aside. Without them, the record would only ever hold the times
 *     you did buy, and could not tell whether holding back paid.
 *
 * Prices after each decision (24 hours, 48 hours, 7, 30 and 90 days) are
 * recorded once each is known and never recomputed, so the record keeps
 * hour-accurate outcomes long after the app's hourly history has moved on.
 */
import type { Action, Currency, OHLCVCandle } from '../types';
import type { LoggedCall } from './trackRecord';
import { ACTION_LABEL } from './signalEngine';
import {
  parseTradeRecord, parseStamp, parseAmount, sortTrades, makeId, priceAt,
  type Trade, type TradeSide, type TradeFigures, type SignalStamp, type PriceSeries,
} from './journal';
import { formatMoney, formatBtc } from './format';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** The genesis block. */
const EARLIEST = Date.UTC(2009, 0, 3);

export const PAPER_KEY = 'btc_dashboard_paper_v1';
export const PAPER_SETTINGS_KEY = 'btc_dashboard_paper_settings_v1';
/** Which half of the Portfolio tab was showing last: real trades or paper. */
export const PORTFOLIO_VIEW_KEY = 'btc_dashboard_portfolio_view_v1';

// ===== What a decision records =====

/** Whose call a paper decision acts on. */
export type AdviceSource = 'app' | 'brief' | 'own';
export const ADVICE_SOURCES: AdviceSource[] = ['app', 'brief', 'own'];
export const ADVICE_LABEL: Record<AdviceSource, string> = {
  app: 'The app',
  brief: "Claude's brief",
  own: 'My own call',
};

/** Why the decision was made now. The guide in the app explains each one. */
export type Scenario = 'routine' | 'signalChange' | 'bigMove' | 'extremeMood' | 'event' | 'tempted' | 'other';
export const SCENARIOS: Scenario[] = ['routine', 'signalChange', 'bigMove', 'extremeMood', 'event', 'tempted', 'other'];
export const SCENARIO_LABEL: Record<Scenario, string> = {
  routine: 'Regular buy day',
  signalChange: 'Advice changed',
  bigMove: 'Big price move',
  extremeMood: 'Extreme fear or greed',
  event: 'News or a big event',
  tempted: 'Tempted to trade for real',
  other: 'Something else',
};

export type BriefVerdict = 'BUY_NOW' | 'WAIT' | 'SPLIT';
export const VERDICTS: BriefVerdict[] = ['BUY_NOW', 'WAIT', 'SPLIT'];
export const VERDICT_LABEL: Record<BriefVerdict, string> = { BUY_NOW: 'Buy now', WAIT: 'Wait', SPLIT: 'Split' };

export type Confidence = 'high' | 'medium' | 'low';
export const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];
export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/** What /btc-brief said, as far as it was entered. Every part is optional. */
export interface BriefCall {
  verdict: BriefVerdict | null;
  confidence: Confidence | null;
  /** The brief's chance, 0 to 100, that the price would be lower than at the decision 24 hours later. */
  lower24h: number | null;
  lower48h: number | null;
  lower7d: number | null;
}

/** The fixed times after a decision at which the price is recorded. */
export const AFTER_HORIZONS = [
  { key: '24h', ms: DAY, label: '24 hours' },
  { key: '48h', ms: 2 * DAY, label: '48 hours' },
  { key: '7d', ms: 7 * DAY, label: '7 days' },
  { key: '30d', ms: 30 * DAY, label: '30 days' },
  { key: '90d', ms: 90 * DAY, label: '90 days' },
] as const;
export type AfterKey = (typeof AFTER_HORIZONS)[number]['key'];
/** BTC/USD at each horizon after a decision, filled in as each one passes. */
export type PricesAfter = Partial<Record<AfterKey, number>>;

/** What every paper decision records on top of the market and the signal. */
export interface DecisionMeta {
  advice: AdviceSource;
  scenario: Scenario;
  /** Your usual amount when you decided, in the decision's currency. */
  usualAmount: number | null;
  /** Usual amount x the app's DCA multiplier then: what following the app meant. */
  suggestedAmount: number | null;
  /** BTC/USD change over the 24 hours before the decision, in %. */
  change24hPct: number | null;
  brief: BriefCall | null;
}

export interface PaperTrade extends Trade {
  paper: DecisionMeta & {
    /** The limit order this trade filled, or null for a trade at the live price. */
    orderId: string | null;
    /** BTC/USD after the trade. */
    after: PricesAfter;
  };
}

export type OrderStatus = 'open' | 'filled' | 'expired' | 'cancelled' | 'lapsed';
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  open: 'Waiting',
  filled: 'Filled',
  expired: 'Ran out',
  cancelled: 'Cancelled',
  lapsed: 'Could not be checked',
};

/** A paper limit buy: spend `total` if the price falls to `limitPrice` before `expiresAt`. */
export interface PaperOrder {
  id: string;
  currency: Currency;
  /** Money set aside, fee included. */
  total: number;
  /** Price per BTC to buy at, in `currency`. */
  limitPrice: number;
  /** Fee charged if it fills, as a % of the total. */
  feePct: number;
  placedAt: number;
  expiresAt: number;
  /** Market price when placed, in `currency`. What waiting saved or cost is measured from this. */
  marketAtPlacement: number;
  marketPriceUsd: number | null;
  marketPriceGbp: number | null;
  /** The signal when the order was placed: that is when the decision was made. */
  signal: SignalStamp | null;
  meta: DecisionMeta;
  note: string;
  status: OrderStatus;
  /** When it filled, ran out, was cancelled or stopped being checkable. */
  closedAt: number | null;
  /** Ran out or cancelled: the market price then, in `currency`. */
  priceAtClose: number | null;
  /** Filled: the paper trade it became. */
  tradeId: string | null;
  /** BTC/USD after the order was placed. */
  after: PricesAfter;
  createdAt: number;
}

/** A decision not to buy. */
export interface PaperSkip {
  id: string;
  time: number;
  currency: Currency;
  marketPriceUsd: number | null;
  marketPriceGbp: number | null;
  signal: SignalStamp | null;
  meta: DecisionMeta;
  note: string;
  after: PricesAfter;
  createdAt: number;
}

export interface PaperBook {
  trades: PaperTrade[];
  orders: PaperOrder[];
  skips: PaperSkip[];
}

export const EMPTY_BOOK: PaperBook = { trades: [], orders: [], skips: [] };

export interface PaperSettings {
  /** What you would normally put in each time, in `currency`. */
  usualAmount: number | null;
  currency: Currency;
  /** Fee on a paper trade at the live price, % of the total. */
  marketFeePct: number;
  /** Fee on a filled paper limit order, % of the total. */
  limitFeePct: number;
}

/**
 * Coinbase Advanced's entry tier: 1.2% to take the live price, 0.6% for a
 * limit order that waits on the book. Fees are part of what the advice costs
 * to follow, so paper trades pay them too. Set them to what your own orders
 * actually cost.
 */
export const DEFAULT_PAPER_SETTINGS: PaperSettings = {
  usualAmount: null,
  currency: 'GBP',
  marketFeePct: 1.2,
  limitFeePct: 0.6,
};

/** How long a paper limit order can wait. Kept well inside the 30 days of hourly history fills are checked on. */
export const ORDER_EXPIRY_DAYS = [1, 2, 7, 14] as const;

// ===== Storage validation =====

const CURRENCIES: Currency[] = ['USD', 'GBP'];
const STATUSES: OrderStatus[] = ['open', 'filled', 'expired', 'cancelled', 'lapsed'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPos = (v: unknown): v is number => isNum(v) && v > 0;
const posOrNull = (v: unknown): number | null => (isPos(v) ? v : null);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);
const pctOrNull = (v: unknown): number | null => (isNum(v) && v >= 0 && v <= 100 ? v : null);
const text = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '');

const parseBrief = (b: any): BriefCall | null => {
  if (!b || typeof b !== 'object') return null;
  const call: BriefCall = {
    verdict: VERDICTS.includes(b.verdict) ? b.verdict : null,
    confidence: CONFIDENCES.includes(b.confidence) ? b.confidence : null,
    lower24h: pctOrNull(b.lower24h),
    lower48h: pctOrNull(b.lower48h),
    lower7d: pctOrNull(b.lower7d),
  };
  return isBriefEmpty(call) ? null : call;
};

export const isBriefEmpty = (b: BriefCall | null): boolean =>
  b == null || (b.verdict == null && b.confidence == null && b.lower24h == null && b.lower48h == null && b.lower7d == null);

const parseMeta = (m: any): DecisionMeta => ({
  // An unreadable source counts as your own call rather than the app's, so a
  // damaged entry can never be scored as "following the app".
  advice: ADVICE_SOURCES.includes(m?.advice) ? m.advice : 'own',
  scenario: SCENARIOS.includes(m?.scenario) ? m.scenario : 'other',
  usualAmount: posOrNull(m?.usualAmount),
  suggestedAmount: isNum(m?.suggestedAmount) && m.suggestedAmount >= 0 ? m.suggestedAmount : null,
  change24hPct: numOrNull(m?.change24hPct),
  brief: parseBrief(m?.brief),
});

const parseAfter = (a: any): PricesAfter => {
  const out: PricesAfter = {};
  if (!a || typeof a !== 'object') return out;
  for (const { key } of AFTER_HORIZONS) if (isPos(a[key])) out[key] = a[key];
  return out;
};

const parsePaperTrade = (t: any): PaperTrade | null => {
  if (!t?.paper || typeof t.paper !== 'object') return null;
  const base = parseTradeRecord(t);
  if (!base) return null;
  return {
    ...base,
    paper: {
      ...parseMeta(t.paper),
      orderId: typeof t.paper.orderId === 'string' && t.paper.orderId ? t.paper.orderId : null,
      after: parseAfter(t.paper.after),
    },
  };
};

const parseOrder = (o: any): PaperOrder | null => {
  if (!o || typeof o.id !== 'string' || !o.id || !CURRENCIES.includes(o.currency)) return null;
  if (!isPos(o.total) || !isPos(o.limitPrice) || !isPos(o.marketAtPlacement)) return null;
  if (!isNum(o.placedAt) || o.placedAt < EARLIEST || !isNum(o.expiresAt) || o.expiresAt <= o.placedAt) return null;
  return {
    id: o.id,
    currency: o.currency,
    total: o.total,
    limitPrice: o.limitPrice,
    feePct: isNum(o.feePct) && o.feePct >= 0 && o.feePct <= 10 ? o.feePct : DEFAULT_PAPER_SETTINGS.limitFeePct,
    placedAt: o.placedAt,
    expiresAt: o.expiresAt,
    marketAtPlacement: o.marketAtPlacement,
    marketPriceUsd: posOrNull(o.marketPriceUsd),
    marketPriceGbp: posOrNull(o.marketPriceGbp),
    signal: parseStamp(o.signal),
    meta: parseMeta(o.meta),
    note: text(o.note),
    status: STATUSES.includes(o.status) ? o.status : 'open',
    closedAt: numOrNull(o.closedAt),
    priceAtClose: posOrNull(o.priceAtClose),
    tradeId: typeof o.tradeId === 'string' && o.tradeId ? o.tradeId : null,
    after: parseAfter(o.after),
    createdAt: isNum(o.createdAt) ? o.createdAt : o.placedAt,
  };
};

const parseSkip = (s: any): PaperSkip | null => {
  if (!s || typeof s.id !== 'string' || !s.id || !CURRENCIES.includes(s.currency)) return null;
  if (!isNum(s.time) || s.time < EARLIEST) return null;
  return {
    id: s.id,
    time: s.time,
    currency: s.currency,
    marketPriceUsd: posOrNull(s.marketPriceUsd),
    marketPriceGbp: posOrNull(s.marketPriceGbp),
    signal: parseStamp(s.signal),
    meta: parseMeta(s.meta),
    note: text(s.note),
    after: parseAfter(s.after),
    createdAt: isNum(s.createdAt) ? s.createdAt : s.time,
  };
};

const uniqueBy = <T extends { id: string }>(items: unknown, parse: (x: any) => T | null): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    const v = parse(item);
    if (v && !seen.has(v.id)) {
      seen.add(v.id);
      out.push(v);
    }
  }
  return out;
};

const sortBook = (b: PaperBook): PaperBook => ({
  trades: sortTrades(b.trades) as PaperTrade[],
  orders: [...b.orders].sort((x, y) => x.placedAt - y.placedAt || x.createdAt - y.createdAt),
  skips: [...b.skips].sort((x, y) => x.time - y.time || x.createdAt - y.createdAt),
});

const bookFrom = (data: any): PaperBook =>
  sortBook({
    trades: uniqueBy(data?.paperTrades, parsePaperTrade),
    orders: uniqueBy(data?.orders, parseOrder),
    skips: uniqueBy(data?.skips, parseSkip),
  });

/** What is stored, and what a backup holds. Trades sit under `paperTrades` so the real journal's parser never sees them. */
export const toStored = (b: PaperBook) => ({ paperTrades: b.trades, orders: b.orders, skips: b.skips });

/** The stored paper record. Invalid entries are dropped, one by one, rather than losing the lot. */
export const parseBook = (raw: string | null): PaperBook => {
  if (!raw) return EMPTY_BOOK;
  try {
    return bookFrom(JSON.parse(raw));
  } catch {
    return EMPTY_BOOK;
  }
};

const clampPct = (v: unknown, fallback: number): number => (isNum(v) && v >= 0 && v <= 10 ? v : fallback);

const settingsFrom = (s: any): PaperSettings => ({
  usualAmount: isPos(s?.usualAmount) && s.usualAmount <= 10_000_000 ? s.usualAmount : null,
  currency: CURRENCIES.includes(s?.currency) ? s.currency : DEFAULT_PAPER_SETTINGS.currency,
  marketFeePct: clampPct(s?.marketFeePct, DEFAULT_PAPER_SETTINGS.marketFeePct),
  limitFeePct: clampPct(s?.limitFeePct, DEFAULT_PAPER_SETTINGS.limitFeePct),
});

export const parsePaperSettings = (raw: string | null): PaperSettings => {
  if (!raw) return DEFAULT_PAPER_SETTINGS;
  try {
    return settingsFrom(JSON.parse(raw));
  } catch {
    return DEFAULT_PAPER_SETTINGS;
  }
};

export const serialisePaperBackup = (b: PaperBook, settings: PaperSettings): string =>
  JSON.stringify(
    { app: 'btc-analyst', kind: 'paper', version: 1, exportedAt: new Date().toISOString(), settings, ...toStored(b) },
    null,
    1
  );

export type PaperRestore =
  | { ok: true; book: PaperBook; settings: PaperSettings | null; count: number }
  | { ok: false; error: string };

/** A paper backup, or a clear refusal of anything else, a backup of real trades above all. */
export const parsePaperBackup = (raw: string): PaperRestore => {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'That is not a backup. Paste the whole thing, from the first { to the last }.' };
  }
  if (data?.kind !== 'paper') {
    const real = Array.isArray(data) || Array.isArray(data?.trades);
    return {
      ok: false,
      error: real
        ? 'That is a backup of your real trades. Restore it from My trades, not here.'
        : 'That text does not contain any paper trades. Paste the whole paper backup, from the first { to the last }.',
    };
  }
  const book = bookFrom(data);
  const count = book.trades.length + book.orders.length + book.skips.length;
  if (!count) return { ok: false, error: 'That paper backup is empty.' };
  return { ok: true, book, settings: data.settings ? settingsFrom(data.settings) : null, count };
};

/** Merge a restored backup in. Same id: the backup wins. */
export const mergeBooks = (current: PaperBook, incoming: PaperBook): PaperBook => {
  const merge = <T extends { id: string }>(a: T[], b: T[]) => {
    const byId = new Map(a.map((x) => [x.id, x]));
    for (const x of b) byId.set(x.id, x);
    return [...byId.values()];
  };
  return sortBook({
    trades: merge(current.trades, incoming.trades),
    orders: merge(current.orders, incoming.orders),
    skips: merge(current.skips, incoming.skips),
  });
};

// ===== Following the advice =====

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Usual amount x the DCA multiplier: what following the app to the letter means right now. */
export const suggestedAmount = (usual: number | null, stamp: SignalStamp | null): number | null =>
  usual != null && usual > 0 && stamp ? round2(usual * stamp.dcaMultiplier) : null;

export type VsApp = 'more' | 'same' | 'less';
export const VS_APP_LABEL: Record<VsApp, string> = {
  more: "More than the app's amount",
  same: "Matches the app's amount",
  less: "Less than the app's amount",
};

/**
 * How an amount compares with what the app suggested. Within 5% (or a pound
 * or dollar, for small amounts) counts as the same: nobody types £131.40.
 * Null when there was no suggestion to compare with.
 */
export const compareWithApp = (amount: number, suggested: number | null): VsApp | null => {
  if (suggested == null) return null;
  const tolerance = Math.max(1, suggested * 0.05);
  if (Math.abs(amount - suggested) <= tolerance) return 'same';
  return amount > suggested ? 'more' : 'less';
};

// ===== Amounts and figures =====

/**
 * Figures for a paper trade at `price`, with the fee taken as a share of the
 * amount, by the same order-details rule as a real trade:
 *
 *   buy:  `amount` is what you pay, fee included; BTC = (amount - fee) / price
 *   sell: `amount` is what the BTC sold is worth; you receive amount - fee
 */
export const paperFigures = (side: TradeSide, amount: number, price: number, feePct: number): TradeFigures | null => {
  if (!(amount > 0) || !(price > 0) || !(feePct >= 0) || feePct >= 100) return null;
  const fee = round2((amount * feePct) / 100);
  if (side === 'buy') {
    const btc = (amount - fee) / price;
    return btc > 0 ? { fiat: amount, btc, unitPrice: price, fee } : null;
  }
  const received = amount - fee;
  return received > 0 ? { fiat: received, btc: amount / price, unitPrice: price, fee } : null;
};

const MAX_AMOUNT = 10_000_000;

export type ParsedPaperAmount = { ok: true; amount: number } | { ok: false; error: string };

/** The amount typed into a paper buy or sell. A sell cannot be for more BTC than the paper holdings. */
export const parsePaperAmount = (
  input: string,
  side: TradeSide,
  price: number | null,
  heldBtc: number,
  currency: Currency
): ParsedPaperAmount => {
  const amount = parseAmount(input);
  if (amount == null || amount <= 0) {
    return { ok: false, error: side === 'buy' ? 'Enter how much to spend, like 100.' : 'Enter how much to sell, like 100.' };
  }
  if (amount > MAX_AMOUNT) return { ok: false, error: 'That is more than this paper account takes in one go.' };
  if (!price || !(price > 0)) return { ok: false, error: 'Waiting for a live price. Paper trades are always at the live price.' };
  if (side === 'sell' && amount / price > heldBtc + 1e-10) {
    return {
      ok: false,
      error:
        heldBtc > 0
          ? `Your paper holdings are ${formatBtc(heldBtc)} BTC, worth ${formatMoney(heldBtc * price, currency)} now. Sell that or less.`
          : 'There is no paper Bitcoin to sell yet.',
    };
  }
  return { ok: true, amount };
};

export type ParsedLimitOrder = { ok: true; total: number; limitPrice: number } | { ok: false; error: string };

/** A paper limit buy. It must sit below today's price, or it would simply fill at once. */
export const parseLimitOrder = (
  amountInput: string,
  limitInput: string,
  market: number | null,
  currency: Currency
): ParsedLimitOrder => {
  const total = parseAmount(amountInput);
  if (total == null || total <= 0) return { ok: false, error: 'Enter how much the order should spend, like 100.' };
  if (total > MAX_AMOUNT) return { ok: false, error: 'That is more than this paper account takes in one go.' };
  const limitPrice = parseAmount(limitInput);
  if (limitPrice == null || limitPrice <= 0) return { ok: false, error: 'Enter the price per BTC to buy at.' };
  if (!market || !(market > 0)) return { ok: false, error: 'Waiting for a live price to place the order against.' };
  if (limitPrice >= market) {
    return {
      ok: false,
      error: `A limit buy at or above today's price (${formatMoney(market, currency)}) would fill straight away. Use Buy now, or set a lower price.`,
    };
  }
  if (limitPrice < market * 0.5) return { ok: false, error: 'That is more than half below today\'s price. Check the figure.' };
  return { ok: true, total, limitPrice };
};

/** A usual amount typed in, or null when the box is empty. 'bad' when it is not a number. */
export const parseUsualAmount = (input: string): number | null | 'bad' => {
  if (!input.trim()) return null;
  const v = parseAmount(input);
  return v == null || v <= 0 || v > MAX_AMOUNT ? 'bad' : v;
};

/** A chance typed as a percentage, 0 to 100. Blank is null; anything else unreadable is 'bad'. */
export const parseChance = (input: string): number | null | 'bad' => {
  const cleaned = input.trim().replace(/%$/, '').trim();
  if (!cleaned) return null;
  const v = parseAmount(cleaned);
  return v == null || v > 100 ? 'bad' : v;
};

// ===== Limit orders =====

export type OrderCheck =
  | { kind: 'open' }
  | { kind: 'filled'; at: number }
  | { kind: 'expired'; priceAtClose: number | null }
  | { kind: 'lapsed' };

/**
 * Whether an open limit buy has filled, from candles in the order's currency.
 *
 * Only whole bars that started at or after the order was placed and ended by
 * its expiry count. A bar that straddles the moment it was placed might have
 * dipped before the order existed, so it is left out, and likewise at the
 * other end. That can miss a fill in the first or last hour, but it never
 * invents one, so paper results are never flattered. (While the app is open,
 * the live price is checked too; see `filledLive`.)
 *
 * A bar's low at or below the limit means a fill at the limit price: a limit
 * order waiting on the book fills at its own price as the market trades down
 * through it. The still-forming bar counts too: its low so far is real.
 *
 * 'expired' needs every bar up to the expiry to be present; 'lapsed' means
 * the history no longer reaches back to when the order was placed (the app
 * was not opened for weeks), so it can no longer be checked either way.
 */
export const checkOrder = (o: PaperOrder, candles: OHLCVCandle[], intervalMs: number): OrderCheck => {
  if (o.status !== 'open' || !candles.length) return { kind: 'open' };
  const firstFull = Math.ceil(o.placedAt / intervalMs) * intervalMs;
  if (firstFull + intervalMs <= o.expiresAt && candles[0]!.time > firstFull) return { kind: 'lapsed' };

  for (const c of candles) {
    if (c.time < o.placedAt) continue;
    if (c.time + intervalMs > o.expiresAt) break;
    if (c.low > 0 && c.low <= o.limitPrice) return { kind: 'filled', at: c.time };
  }

  const last = candles[candles.length - 1]!;
  // The last bar is the one forming now, so the data reaches past the expiry
  // only once that bar ends after it.
  if (last.time + intervalMs > o.expiresAt) {
    return { kind: 'expired', priceAtClose: priceAt(o.expiresAt, [{ candles, intervalMs }]) };
  }
  return { kind: 'open' };
};

/** The live price seen while the app is open, at `seenAt`, reaching an open order's limit. */
export const filledLive = (o: PaperOrder, livePrice: number | null | undefined, seenAt: number): boolean =>
  o.status === 'open' && livePrice != null && livePrice > 0 && livePrice <= o.limitPrice && seenAt > o.placedAt && seenAt <= o.expiresAt;

/**
 * BTC/USD and BTC/GBP at the moment of a fill. The order's own currency is the
 * limit price, exactly; the other is converted at that hour's exchange rate,
 * implied by the two series, or at today's rate when they do not cover it.
 */
export const fillMarketPrices = (
  o: PaperOrder,
  at: number,
  usd: PriceSeries[],
  gbp: PriceSeries[],
  live: { usd: number; gbp: number } | null
): { usd: number | null; gbp: number | null } => {
  const u = priceAt(at, usd);
  const g = priceAt(at, gbp);
  const usdPerGbp = u && g ? u / g : live && live.usd > 0 && live.gbp > 0 ? live.usd / live.gbp : null;
  if (o.currency === 'USD') return { usd: o.limitPrice, gbp: usdPerGbp ? o.limitPrice / usdPerGbp : null };
  return { gbp: o.limitPrice, usd: usdPerGbp ? o.limitPrice * usdPerGbp : null };
};

/** Turn a filled order into the paper trade it became. The trade carries the decision as it was made at placement. */
export const fillOrder = (
  o: PaperOrder,
  at: number,
  market: { usd: number | null; gbp: number | null },
  now: number = Date.now()
): { order: PaperOrder; trade: PaperTrade } | null => {
  const f = paperFigures('buy', o.total, o.limitPrice, o.feePct);
  if (!f || f.btc == null) return null;
  const trade: PaperTrade = {
    id: makeId(now),
    side: 'buy',
    time: at,
    fiat: f.fiat,
    currency: o.currency,
    btc: f.btc,
    unitPrice: o.limitPrice,
    fee: f.fee,
    marketPriceUsd: market.usd,
    marketPriceGbp: market.gbp,
    signal: o.signal,
    note: o.note,
    createdAt: now,
    paper: { ...o.meta, orderId: o.id, after: {} },
  };
  return { order: { ...o, status: 'filled', closedAt: at, tradeId: trade.id }, trade };
};

// ===== Prices after each decision =====

/** The bar of `s` containing `t`, or null. */
const barAt = (t: number, s: PriceSeries): OHLCVCandle | null => {
  const c = s.candles;
  if (!c.length || t < c[0]!.time || t >= c[c.length - 1]!.time + s.intervalMs) return null;
  let lo = 0;
  let hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c[mid]!.time <= t) lo = mid;
    else hi = mid - 1;
  }
  const bar = c[lo]!;
  return t < bar.time + s.intervalMs && bar.close > 0 ? bar : null;
};

/**
 * The price at `t`, but only once it is settled. An hourly bar's close is
 * within the hour, so it is used as soon as the hour has started. A coarser
 * bar is used only once it has closed: the still-forming daily bar's "close"
 * is just the price now, which could be most of a day from `t`.
 */
export const settledPriceAt = (t: number, series: PriceSeries[], now: number): number | null => {
  for (const s of series) {
    const bar = barAt(t, s);
    if (!bar) continue;
    return s.intervalMs > HOUR && bar.time + s.intervalMs > now ? null : bar.close;
  }
  return null;
};

/**
 * Fill in any horizons that have passed since `from`. Returns the same object
 * when nothing changed, so callers can skip a write.
 */
export const recordAfter = (after: PricesAfter, from: number, series: PriceSeries[], now: number): PricesAfter => {
  let next: PricesAfter | null = null;
  for (const { key, ms } of AFTER_HORIZONS) {
    if (after[key] != null || from + ms > now) continue;
    const p = settledPriceAt(from + ms, series, now);
    if (p == null) continue;
    next = next ?? { ...after };
    next[key] = p;
  }
  return next ?? after;
};

/** Record due prices across the whole book. Returns the same book when nothing changed. */
export const recordBookAfter = (b: PaperBook, series: PriceSeries[], now: number): PaperBook => {
  let changed = false;
  const trades = b.trades.map((t) => {
    const after = recordAfter(t.paper.after, t.time, series, now);
    if (after === t.paper.after) return t;
    changed = true;
    return { ...t, paper: { ...t.paper, after } };
  });
  const orders = b.orders.map((o) => {
    const after = recordAfter(o.after, o.placedAt, series, now);
    if (after === o.after) return o;
    changed = true;
    return { ...o, after };
  });
  const skips = b.skips.map((s) => {
    const after = recordAfter(s.after, s.time, series, now);
    if (after === s.after) return s;
    changed = true;
    return { ...s, after };
  });
  return changed ? { trades, orders, skips } : b;
};

/** Whether any decision has a horizon that has passed but is not recorded yet. */
export const hasDueAfter = (b: PaperBook, now: number): boolean => {
  const due = (after: PricesAfter, from: number) => AFTER_HORIZONS.some(({ key, ms }) => after[key] == null && from + ms <= now);
  return (
    b.trades.some((t) => due(t.paper.after, t.time)) ||
    b.orders.some((o) => due(o.after, o.placedAt)) ||
    b.skips.some((s) => due(s.after, s.time))
  );
};

/** Fractional BTC/USD move from a decision's own price to a recorded later price. */
export const moveAfter = (from: number | null, after: PricesAfter, key: AfterKey): number | null => {
  const later = after[key];
  return from != null && from > 0 && later != null ? later / from - 1 : null;
};

// ===== What is going on now =====

export interface Conditions {
  /** Scenarios today's market fits, most notable first. */
  scenarios: Scenario[];
  /** One plain line per condition, for under the "Why now?" choices. */
  notes: string[];
}

/** A daily move this size or more counts as big. Bitcoin's typical day is 2 to 3%. */
export const BIG_MOVE_PCT = 5;
/** The same over a week. */
export const BIG_WEEK_PCT = 10;

/**
 * Which scenarios the market fits right now, so the sheet can say so. It does
 * not choose for you: "why now?" is about why you are deciding, which only
 * you know. The facts themselves are recorded with every decision anyway.
 */
export const detectConditions = (input: {
  change24hPct: number | null;
  change7dPct?: number | null;
  fearGreed: number | null;
  /** Today's advice and the last different one before it, if the advice changed in the last two days. */
  adviceChange: { from: string; to: string } | null;
}): Conditions => {
  const scenarios: Scenario[] = [];
  const notes: string[] = [];
  if (input.adviceChange) {
    scenarios.push('signalChange');
    notes.push(`The advice changed from ${input.adviceChange.from} to ${input.adviceChange.to} in the last two days.`);
  }
  const ch = input.change24hPct;
  const wk = input.change7dPct ?? null;
  const bigDay = ch != null && Math.abs(ch) >= BIG_MOVE_PCT;
  const bigWeek = wk != null && Math.abs(wk) >= BIG_WEEK_PCT;
  if (bigDay || bigWeek) scenarios.push('bigMove');
  if (bigDay) notes.push(`Bitcoin is ${ch! > 0 ? 'up' : 'down'} ${Math.abs(ch!).toFixed(1)}% in 24 hours.`);
  if (bigWeek) notes.push(`Bitcoin is ${wk! > 0 ? 'up' : 'down'} ${Math.abs(wk!).toFixed(1)}% in a week.`);
  const fg = input.fearGreed;
  if (fg != null && (fg <= 20 || fg >= 80)) {
    scenarios.push('extremeMood');
    notes.push(`Fear & Greed is ${fg}: extreme ${fg <= 20 ? 'fear' : 'greed'}.`);
  }
  return { scenarios, notes };
};

/**
 * The advice changed tier if the last two days the app logged disagree, and
 * the newer one is recent. The log keeps the first call shown each day.
 */
export const adviceChangeFrom = (log: LoggedCall[], now: number): { from: string; to: string } | null => {
  const latest = log[log.length - 1];
  const before = log[log.length - 2];
  if (!latest || !before || now - (latest.day + DAY) > 2 * DAY || latest.action === before.action) return null;
  return { from: ACTION_LABEL[before.action as Action], to: ACTION_LABEL[latest.action as Action] };
};

/** BTC/USD change over the week to `now`, in %, from daily candles. */
export const change7d = (daily: OHLCVCandle[], livePrice: number | null, now: number): number | null => {
  if (!livePrice || !(livePrice > 0)) return null;
  const before = priceAt(now - 7 * DAY, [{ candles: daily, intervalMs: DAY }]);
  return before ? (livePrice / before - 1) * 100 : null;
};

/** BTC/USD change over the 24 hours to `now`, in %, from hourly candles. */
export const change24h = (hourly: OHLCVCandle[], livePrice: number | null, now: number): number | null => {
  if (!livePrice || !(livePrice > 0)) return null;
  const before = priceAt(now - DAY, [{ candles: hourly, intervalMs: HOUR }]);
  return before ? (livePrice / before - 1) * 100 : null;
};

// ===== One timeline =====

export type Decision =
  | { kind: 'trade'; time: number; trade: PaperTrade; order: PaperOrder | null }
  | { kind: 'order'; time: number; order: PaperOrder }
  | { kind: 'skip'; time: number; skip: PaperSkip };

/**
 * Every decision, newest first. A filled order appears once, as the trade it
 * became; orders still waiting are left out (they are shown on their own).
 */
export const timeline = (b: PaperBook): Decision[] => {
  const orders = new Map(b.orders.map((o) => [o.id, o]));
  const items: Decision[] = [
    ...b.trades.map((t) => ({ kind: 'trade' as const, time: t.time, trade: t, order: t.paper.orderId ? orders.get(t.paper.orderId) ?? null : null })),
    ...b.orders.filter((o) => o.status !== 'open' && o.status !== 'filled').map((o) => ({ kind: 'order' as const, time: o.placedAt, order: o })),
    ...b.skips.map((s) => ({ kind: 'skip' as const, time: s.time, skip: s })),
  ];
  return items.sort((x, y) => y.time - x.time);
};

/** Remove a decision. Deleting a filled order's trade removes the order too: they are one decision. */
export const deleteFromBook = (b: PaperBook, kind: 'trade' | 'order' | 'skip', id: string): PaperBook => {
  if (kind === 'skip') return { ...b, skips: b.skips.filter((s) => s.id !== id) };
  if (kind === 'order') {
    const o = b.orders.find((x) => x.id === id);
    return {
      ...b,
      orders: b.orders.filter((x) => x.id !== id),
      trades: o?.tradeId ? b.trades.filter((t) => t.id !== o.tradeId) : b.trades,
    };
  }
  const t = b.trades.find((x) => x.id === id);
  return {
    ...b,
    trades: b.trades.filter((x) => x.id !== id),
    orders: t?.paper.orderId ? b.orders.filter((o) => o.id !== t.paper.orderId) : b.orders,
  };
};

// ===== Export =====

const csvCell = (v: string | number | null | undefined): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const r2 = (v: number | null | undefined) => (v == null ? null : +v.toFixed(2));
const pct2 = (v: number | null) => (v == null ? null : +(v * 100).toFixed(2));
const iso = (t: number | null | undefined) => (t == null ? null : new Date(t).toISOString());

/**
 * One row per decision, oldest first, with everything recorded about it. The
 * `after_*` columns are the BTC/USD move from the decision (for a limit order,
 * from when it was placed) to each horizon, in %. Blank means not reached yet.
 */
export const paperToCsv = (b: PaperBook): string => {
  const header = [
    'record', 'status', 'decided_utc', 'done_utc', 'side', 'total', 'currency', 'btc', 'price', 'fee',
    'market_price_usd', 'market_price_gbp', 'following', 'why', 'usual_amount', 'app_suggested', 'vs_app',
    'change_24h_pct', 'signal', 'dca_multiplier', 'conviction', 'target_allocation', 'regime', 'regime_score',
    'fear_greed', 'fear_greed_label', 'rsi', 'volatility_pct', 'vs_200d_avg_pct', 'stretch', 'momentum',
    'brief_verdict', 'brief_confidence', 'brief_lower_24h', 'brief_lower_48h', 'brief_lower_7d',
    'limit_price', 'market_at_placement', 'limit_below_market_pct', 'expires_utc', 'price_at_close',
    'after_24h_pct', 'after_48h_pct', 'after_7d_pct', 'after_30d_pct', 'after_90d_pct', 'note',
  ];
  type Row = { time: number; cells: (string | number | null | undefined)[] };
  const row = (r: {
    record: string; status: string; decided: number; done: number | null; side: string;
    total: number | null; currency: Currency; btc: number | null; price: number | null; fee: number | null;
    usd: number | null; gbp: number | null; meta: DecisionMeta; amountForApp: number | null; signal: SignalStamp | null;
    order: PaperOrder | null; after: PricesAfter; note: string;
  }): Row => {
    const s = r.signal;
    const vs = r.amountForApp == null ? null : compareWithApp(r.amountForApp, r.meta.suggestedAmount);
    const o = r.order;
    return {
      time: r.decided,
      cells: [
        r.record, r.status, iso(r.decided), iso(r.done), r.side, r2(r.total), r.currency, r.btc, r2(r.price), r2(r.fee),
        r.usd, r.gbp, r.meta.advice, r.meta.scenario, r.meta.usualAmount, r.meta.suggestedAmount, vs,
        r2(r.meta.change24hPct), s?.action, s?.dcaMultiplier, s?.conviction, s ? +s.targetAllocation.toFixed(3) : null,
        s?.regime, s?.regimeScore, s?.fearGreed, s?.fearGreedLabel, r2(s?.rsi), r2(s?.atrPct), r2(s?.priceVsSma200Pct),
        r2(s?.stretchScore), r2(s?.momentumScore),
        r.meta.brief?.verdict, r.meta.brief?.confidence, r.meta.brief?.lower24h, r.meta.brief?.lower48h, r.meta.brief?.lower7d,
        o?.limitPrice, o?.marketAtPlacement, o ? pct2(1 - o.limitPrice / o.marketAtPlacement) : null, iso(o?.expiresAt),
        r2(o?.priceAtClose),
        ...AFTER_HORIZONS.map(({ key }) => pct2(moveAfter(r.usd, r.after, key))),
        r.note,
      ],
    };
  };

  const rows: Row[] = [];
  for (const t of b.trades) {
    if (t.paper.orderId) continue; // written out with its order below
    rows.push(row({
      record: t.side, status: 'done', decided: t.time, done: t.time, side: t.side, total: t.fiat, currency: t.currency,
      btc: t.btc, price: t.unitPrice, fee: t.fee, usd: t.marketPriceUsd, gbp: t.marketPriceGbp, meta: t.paper,
      amountForApp: t.side === 'buy' ? t.fiat : null, signal: t.signal, order: null, after: t.paper.after, note: t.note,
    }));
  }
  for (const o of b.orders) {
    const filled = o.tradeId ? b.trades.find((t) => t.id === o.tradeId) ?? null : null;
    rows.push(row({
      record: 'limit buy', status: o.status, decided: o.placedAt, done: o.closedAt, side: 'buy', total: o.total,
      currency: o.currency, btc: filled?.btc ?? null, price: o.limitPrice, fee: filled?.fee ?? null,
      usd: o.marketPriceUsd, gbp: o.marketPriceGbp, meta: o.meta, amountForApp: o.total, signal: o.signal,
      order: o, after: o.after, note: o.note,
    }));
  }
  for (const s of b.skips) {
    rows.push(row({
      record: 'no buy', status: 'done', decided: s.time, done: s.time, side: '', total: 0, currency: s.currency,
      btc: null, price: null, fee: null, usd: s.marketPriceUsd, gbp: s.marketPriceGbp, meta: s.meta, amountForApp: 0,
      signal: s.signal, order: null, after: s.after, note: s.note,
    }));
  }
  rows.sort((x, y) => x.time - y.time);
  return [header.join(','), ...rows.map((r) => r.cells.map(csvCell).join(','))].join('\n');
};
