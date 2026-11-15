/**
 * A yearly summary of gains for a UK tax return, worked out from the trades
 * logged in the app.
 *
 * HMRC treats Bitcoin like shares for Capital Gains Tax. Each sale is matched
 * against purchases in this order:
 *
 *   1. Same day: Bitcoin bought on the same day as the sale.
 *   2. The next 30 days: Bitcoin bought in the 30 days after the sale
 *      ("bed and breakfasting"), earliest first.
 *   3. The pool: everything else, at its average cost ("section 104 pool").
 *
 * Costs include the fee paid on each buy, and proceeds are what each sale
 * paid out after its fee. Everything is in pounds: a dollar trade is
 * converted at the rate on its own day, from the BTC prices it recorded.
 *
 * The starting balance enters the pool on its date at what you put in. It is
 * a single figure for coins bought over time, so the matching rules cannot be
 * applied inside it; that is the main reason this is an estimate.
 */
import type { LivePrices, OpeningPosition, Trade } from './journal';
import { convertAtTrade, isCoveredByOpening } from './journal';

/** The tax-free allowance for gains (annual exempt amount), by the year a tax year starts. */
const ALLOWANCE: Record<number, number> = {
  2018: 11700, 2019: 12000, 2020: 12300, 2021: 12300, 2022: 12300, 2023: 6000, 2024: 3000, 2025: 3000, 2026: 3000,
};

export const allowanceFor = (startYear: number): { amount: number; known: boolean } => {
  if (ALLOWANCE[startYear] != null) return { amount: ALLOWANCE[startYear]!, known: true };
  const years = Object.keys(ALLOWANCE).map(Number);
  const latest = Math.max(...years);
  return startYear > latest ? { amount: ALLOWANCE[latest]!, known: false } : { amount: ALLOWANCE[Math.min(...years)]!, known: false };
};

/** The tax year a moment falls in, by its start year: 6 April 2025 to 5 April 2026 is 2025. Local (UK) dates. */
export const taxYearOf = (t: number): number => {
  const d = new Date(t);
  const y = d.getFullYear();
  const beforeStart = d.getMonth() < 3 || (d.getMonth() === 3 && d.getDate() < 6);
  return beforeStart ? y - 1 : y;
};

export const taxYearLabel = (startYear: number): string => `${startYear} to ${startYear + 1}`;

/** A local calendar day number, so "same day" and "30 days" follow UK dates. */
const dayNumber = (t: number): number => {
  const d = new Date(t);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
};

interface DayBook {
  day: number;
  time: number;
  buyQty: number;
  buyCost: number;
  sellQty: number;
  sellProceeds: number;
  /** Cost matched to the day's sales so far. */
  matchedCost: number;
}

export interface TaxYearSummary {
  startYear: number;
  label: string;
  disposals: number;
  proceeds: number;
  costs: number;
  /** Proceeds minus costs, after setting losses against gains in the same year. */
  net: number;
  gains: number;
  losses: number;
  allowance: number;
  /** False when the allowance for that year is assumed from the latest known one. */
  allowanceKnown: boolean;
  /** Net gain above the allowance: the part that could be taxed. */
  overAllowance: number;
}

export interface TaxSummary {
  years: TaxYearSummary[];
  /** Some dollar amount had no prices from its day, so today's rate was used. */
  atTodaysRate: boolean;
  /** More was sold than was ever logged as held, so some costs are missing. */
  unmatched: boolean;
  /** A starting balance is part of the pool. */
  usesOpening: boolean;
}

export const taxSummary = (trades: Trade[], opening: OpeningPosition | null, live: LivePrices): TaxSummary => {
  let atTodaysRate = false;
  let unmatched = false;
  const gbp = (amount: number, t: Trade) => {
    const c = convertAtTrade(amount, t.currency, 'GBP', t, live);
    if (c.atToday) atTodaysRate = true;
    return c.value;
  };

  const books = new Map<number, DayBook>();
  const book = (t: number): DayBook => {
    const k = dayNumber(t);
    let b = books.get(k);
    if (!b) {
      b = { day: k, time: t, buyQty: 0, buyCost: 0, sellQty: 0, sellProceeds: 0, matchedCost: 0 };
      books.set(k, b);
    }
    return b;
  };
  for (const t of trades) {
    if (isCoveredByOpening(t, opening)) continue;
    const b = book(t.time);
    if (t.side === 'buy') {
      b.buyQty += t.btc;
      b.buyCost += gbp(t.fiat, t);
    } else {
      b.sellQty += t.btc;
      b.sellProceeds += gbp(t.fiat, t);
    }
  }
  const days = [...books.values()].sort((a, b) => a.day - b.day);
  // What is left to match on each side, per day.
  const buyLeft = new Map(days.map((d) => [d.day, d.buyQty]));
  const sellLeft = new Map(days.map((d) => [d.day, d.sellQty]));
  const take = (d: DayBook, qty: number) => {
    const q = Math.min(qty, buyLeft.get(d.day) ?? 0);
    buyLeft.set(d.day, (buyLeft.get(d.day) ?? 0) - q);
    return { qty: q, cost: d.buyQty > 0 ? (d.buyCost * q) / d.buyQty : 0 };
  };

  // 1. Same day.
  for (const d of days) {
    if (!d.sellQty || !d.buyQty) continue;
    const m = take(d, d.sellQty);
    d.matchedCost += m.cost;
    sellLeft.set(d.day, d.sellQty - m.qty);
  }
  // 2. The next 30 days, earliest first.
  for (const d of days) {
    let left = sellLeft.get(d.day) ?? 0;
    if (left <= 1e-12) continue;
    for (const later of days) {
      if (later.day <= d.day || later.day > d.day + 30 || left <= 1e-12) continue;
      const m = take(later, left);
      d.matchedCost += m.cost;
      left -= m.qty;
    }
    sellLeft.set(d.day, left);
  }
  // 3. The pool, in date order. The starting balance enters it first.
  let poolQty = 0;
  let poolCost = 0;
  if (opening) {
    poolQty = opening.btc;
    const c = opening.currency === 'GBP' ? opening.invested : convertAtTrade(opening.invested, opening.currency, 'GBP', { marketPriceUsd: null, marketPriceGbp: null }, live).value;
    if (opening.currency !== 'GBP') atTodaysRate = true;
    poolCost = c;
  }
  for (const d of days) {
    const add = buyLeft.get(d.day) ?? 0;
    if (add > 1e-12) {
      poolCost += (d.buyCost * add) / d.buyQty;
      poolQty += add;
    }
    const sell = sellLeft.get(d.day) ?? 0;
    if (sell > 1e-12) {
      const fromPool = Math.min(sell, poolQty);
      if (sell > poolQty + 1e-10) unmatched = true;
      const cost = poolQty > 0 ? (poolCost * fromPool) / poolQty : 0;
      d.matchedCost += cost;
      poolCost -= cost;
      poolQty -= fromPool;
    }
  }

  const byYear = new Map<number, TaxYearSummary>();
  for (const d of days) {
    if (!d.sellQty) continue;
    const y = taxYearOf(d.time);
    const allowance = allowanceFor(y);
    const s = byYear.get(y) ?? {
      startYear: y, label: taxYearLabel(y), disposals: 0, proceeds: 0, costs: 0, net: 0, gains: 0, losses: 0,
      allowance: allowance.amount, allowanceKnown: allowance.known, overAllowance: 0,
    };
    const gain = d.sellProceeds - d.matchedCost;
    s.disposals++;
    s.proceeds += d.sellProceeds;
    s.costs += d.matchedCost;
    if (gain >= 0) s.gains += gain;
    else s.losses -= gain;
    s.net = s.gains - s.losses;
    s.overAllowance = Math.max(0, s.net - s.allowance);
    byYear.set(y, s);
  }
  return {
    years: [...byYear.values()].sort((a, b) => b.startYear - a.startYear),
    atTodaysRate,
    unmatched,
    usesOpening: opening != null,
  };
};
