/**
 * Scoring the paper record: how the advice you followed on paper has done.
 *
 * Pure, and tested, like the rest of src/services.
 *
 * What it can and cannot tell you
 * -------------------------------
 * A paper record fills slowly, a handful of decisions a week, and a month's
 * Bitcoin move is routinely 20% either way. So most of what is here is
 * noise for months, and every figure carries its sample size. Groups below
 * MIN_GROUP buys, and Claude's calls below MIN_CALLS, are flagged as too few
 * to judge. The engine is never retuned from this (see CLAUDE.md); the record
 * is for spotting where a change might be worth testing on a decade of data
 * with `yarn backtest --split`, and for checking whether /btc-brief's
 * short-term chances are any better than a coin flip.
 *
 * Every price move is BTC/USD, measured from the price at the decision (for a
 * limit order, when it was placed), so the five kinds of figure here all mean
 * the same thing and match the Track record on the Signals tab.
 */
import type { Action } from '../types';
import type { Trade, LivePrices } from './journal';
import { convert } from './journal';
import { ACTION_LABEL } from './signalEngine';
import {
  ADVICE_LABEL, ADVICE_SOURCES, SCENARIO_LABEL, SCENARIOS, VERDICT_LABEL, VERDICTS, VS_APP_LABEL, compareWithApp, moveAfter,
  type AdviceSource, type BriefCall, type BriefVerdict, type PaperBook, type PaperTrade, type PricesAfter, type Scenario, type VsApp,
} from './paper';
import { formatMoney, formatPct } from './format';

const DAY = 24 * 60 * 60 * 1000;

/** Fewer buys than this in a group, and its average is mostly luck. */
export const MIN_GROUP = 5;
/** Fewer of Claude's calls than this, and its hit rate is mostly luck. */
export const MIN_CALLS = 20;
/** Fewer separate days than this, and the comparison with even buying is mostly luck. */
export const MIN_DAYS = 8;

export interface Mean {
  n: number;
  mean: number | null;
}

const meanOf = (xs: number[]): Mean => ({ n: xs.length, mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null });

export interface OutcomeGroup {
  key: string;
  label: string;
  buys: number;
  /** BTC/USD move 7 and 30 days after the buys old enough to have one. */
  after7d: Mean;
  after30d: Mean;
}

export interface VsFlat {
  /** Separate days with a buy decision (a buy, a filled limit order or a decision not to buy). */
  days: number;
  /** Paper money put in on those days, in pounds. */
  invested: number;
  /** Average price per BTC in pounds, before fees, for what you did and for the same money spread evenly. */
  adviceAvgCost: number;
  flatAvgCost: number;
  /** Positive: your paper buys got more Bitcoin per pound than spreading the money evenly. */
  advantagePct: number;
}

export interface Calibration {
  key: '24h' | '48h' | '7d';
  label: string;
  /** Calls with a chance entered and a price recorded at that horizon. */
  n: number;
  /** Average chance Claude gave that the price would be lower, 0 to 1. */
  meanForecast: number | null;
  /** How often it actually was lower, 0 to 1. */
  lowerRate: number | null;
  /** Mean squared error of the chances. Always saying 50% scores 0.25; lower is better. */
  brier: number | null;
}

export interface VerdictGroup {
  verdict: BriefVerdict;
  label: string;
  n: number;
  after24h: Mean;
  after7d: Mean;
}

export interface OrderStats {
  placed: number;
  open: number;
  filled: number;
  expired: number;
  cancelled: number;
  lapsed: number;
  /** Filled out of those that filled or ran out. */
  fillRate: number | null;
  /** Filled orders: how far below the price when placed they bought, as a fraction. */
  saving: Mean;
  hoursToFill: Mean;
  /** Orders that ran out: how far the price had moved from placement by then, as a fraction. */
  missed: Mean;
}

export interface AvgPaid {
  buys: number;
  /** Pounds per BTC, fees included. */
  avgPrice: number;
}

export interface RealVsPaper {
  since: number;
  real: AvgPaid;
  paper: AvgPaid;
  /** Positive: real buys paid more per BTC than paper ones. */
  diffPct: number;
}

export interface PaperScorecard {
  since: number | null;
  decisions: number;
  buys: number;
  sells: number;
  skips: number;
  vsFlat: VsFlat | null;
  bySource: OutcomeGroup[];
  byScenario: OutcomeGroup[];
  byTier: OutcomeGroup[];
  byVsApp: OutcomeGroup[];
  calibration: Calibration[];
  verdicts: VerdictGroup[];
  orders: OrderStats;
  realVsPaper: RealVsPaper | null;
}

// ===== Groups =====

const TIERS: Action[] = ['ACCUMULATE_STRONG', 'ACCUMULATE', 'HOLD', 'REDUCE', 'EXIT'];
const VS_APP: VsApp[] = ['same', 'more', 'less'];

/**
 * Buys only, as on the real Portfolio tab: a sell's good outcome points the
 * other way, and averaging the two together cancels into nothing.
 */
const groupBuys = <K extends string>(
  buys: PaperTrade[],
  keyOf: (t: PaperTrade) => K | null,
  order: readonly K[],
  label: (k: K) => string
): OutcomeGroup[] => {
  const acc = new Map<K, { buys: number; m7: number[]; m30: number[] }>();
  for (const t of buys) {
    const k = keyOf(t);
    if (k == null) continue;
    const g = acc.get(k) ?? { buys: 0, m7: [], m30: [] };
    g.buys++;
    const m7 = moveAfter(t.marketPriceUsd, t.paper.after, '7d');
    const m30 = moveAfter(t.marketPriceUsd, t.paper.after, '30d');
    if (m7 != null) g.m7.push(m7);
    if (m30 != null) g.m30.push(m30);
    acc.set(k, g);
  }
  return order.filter((k) => acc.has(k)).map((k) => {
    const g = acc.get(k)!;
    return { key: k, label: label(k), buys: g.buys, after7d: meanOf(g.m7), after30d: meanOf(g.m30) };
  });
};

// ===== Against spreading the same money evenly =====

/** Pounds, from an amount in the decision's currency, at the exchange rate of the moment it was made. */
const toGbpThen = (amount: number, currency: Trade['currency'], usd: number | null, gbp: number | null): number | null =>
  currency === 'GBP' ? amount : usd && gbp ? amount * (gbp / usd) : null;

/**
 * Did the amounts you chose, and the limit orders, buy more cheaply than
 * putting the same total in evenly on the same days? This is the paper
 * version of the Track record's DCA check, and the clearest test of whether
 * following the multiplier pays.
 *
 * One entry per day, however many decisions it held, so a split buy counts
 * once. Before fees, so it measures timing alone. A filled limit order counts
 * on the day it was placed, at its limit price, since waiting for it was that
 * day's decision; an order that never filled is left out, and whatever you
 * did instead is its own decision.
 */
const compareWithFlat = (b: PaperBook): VsFlat | null => {
  const entries: { time: number; money: number; btc: number; priceGbp: number }[] = [];
  for (const t of b.trades) {
    if (t.side !== 'buy' || t.paper.orderId) continue;
    const price = t.unitPrice ?? t.fiat / t.btc;
    const money = toGbpThen(t.fiat, t.currency, t.marketPriceUsd, t.marketPriceGbp);
    if (money == null || !t.marketPriceGbp || !(price > 0)) continue;
    entries.push({ time: t.time, money, btc: t.fiat / price, priceGbp: t.marketPriceGbp });
  }
  for (const o of b.orders) {
    if (o.status !== 'filled') continue;
    const money = toGbpThen(o.total, o.currency, o.marketPriceUsd, o.marketPriceGbp);
    if (money == null || !o.marketPriceGbp) continue;
    entries.push({ time: o.placedAt, money, btc: o.total / o.limitPrice, priceGbp: o.marketPriceGbp });
  }
  for (const s of b.skips) {
    if (s.marketPriceGbp) entries.push({ time: s.time, money: 0, btc: 0, priceGbp: s.marketPriceGbp });
  }
  entries.sort((x, y) => x.time - y.time);

  const days = new Map<number, { priceGbp: number }>();
  let invested = 0;
  let adviceBtc = 0;
  for (const e of entries) {
    const day = Math.floor(e.time / DAY);
    // The even buyer buys at the first price of the day, when the first decision was made.
    if (!days.has(day)) days.set(day, { priceGbp: e.priceGbp });
    invested += e.money;
    adviceBtc += e.btc;
  }
  if (days.size < 2 || !(invested > 0) || !(adviceBtc > 0)) return null;
  const each = invested / days.size;
  let flatBtc = 0;
  for (const d of days.values()) flatBtc += each / d.priceGbp;
  const adviceAvgCost = invested / adviceBtc;
  const flatAvgCost = invested / flatBtc;
  return { days: days.size, invested, adviceAvgCost, flatAvgCost, advantagePct: ((flatAvgCost - adviceAvgCost) / flatAvgCost) * 100 };
};

// ===== Claude's short-term calls =====

interface BriefDecision {
  brief: BriefCall;
  priceUsd: number | null;
  after: PricesAfter;
}

/** Each brief once: a trade at the live price, an order (not the trade it became), or a decision not to buy. */
const briefDecisions = (b: PaperBook): BriefDecision[] => {
  const out: BriefDecision[] = [];
  for (const t of b.trades) if (t.paper.brief && !t.paper.orderId) out.push({ brief: t.paper.brief, priceUsd: t.marketPriceUsd, after: t.paper.after });
  for (const o of b.orders) if (o.meta.brief) out.push({ brief: o.meta.brief, priceUsd: o.marketPriceUsd, after: o.after });
  for (const s of b.skips) if (s.meta.brief) out.push({ brief: s.meta.brief, priceUsd: s.marketPriceUsd, after: s.after });
  return out;
};

const CALIBRATED = [
  { key: '24h', field: 'lower24h', label: '24 hours' },
  { key: '48h', field: 'lower48h', label: '48 hours' },
  { key: '7d', field: 'lower7d', label: '7 days' },
] as const;

const calibrate = (calls: BriefDecision[]): Calibration[] =>
  CALIBRATED.map(({ key, field, label }) => {
    const pairs: { f: number; o: number }[] = [];
    for (const c of calls) {
      const chance = c.brief[field];
      const move = moveAfter(c.priceUsd, c.after, key);
      if (chance == null || move == null) continue;
      pairs.push({ f: chance / 100, o: move < 0 ? 1 : 0 });
    }
    const n = pairs.length;
    return {
      key,
      label,
      n,
      meanForecast: n ? pairs.reduce((a, p) => a + p.f, 0) / n : null,
      lowerRate: n ? pairs.reduce((a, p) => a + p.o, 0) / n : null,
      brier: n ? pairs.reduce((a, p) => a + (p.f - p.o) ** 2, 0) / n : null,
    };
  });

const verdictGroups = (calls: BriefDecision[]): VerdictGroup[] => {
  const acc = new Map<BriefVerdict, { n: number; m24: number[]; m7: number[] }>();
  for (const c of calls) {
    const v = c.brief.verdict;
    if (!v) continue;
    const g = acc.get(v) ?? { n: 0, m24: [], m7: [] };
    g.n++;
    const m24 = moveAfter(c.priceUsd, c.after, '24h');
    const m7 = moveAfter(c.priceUsd, c.after, '7d');
    if (m24 != null) g.m24.push(m24);
    if (m7 != null) g.m7.push(m7);
    acc.set(v, g);
  }
  return VERDICTS.filter((v) => acc.has(v)).map((v) => {
    const g = acc.get(v)!;
    return { verdict: v, label: VERDICT_LABEL[v], n: g.n, after24h: meanOf(g.m24), after7d: meanOf(g.m7) };
  });
};

// ===== Limit orders =====

const orderStats = (b: PaperBook): OrderStats => {
  const count = (s: string) => b.orders.filter((o) => o.status === s).length;
  const filled = b.orders.filter((o) => o.status === 'filled');
  const expired = b.orders.filter((o) => o.status === 'expired');
  const settled = filled.length + expired.length;
  return {
    placed: b.orders.length,
    open: count('open'),
    filled: filled.length,
    expired: expired.length,
    cancelled: count('cancelled'),
    lapsed: count('lapsed'),
    fillRate: settled ? filled.length / settled : null,
    saving: meanOf(filled.map((o) => 1 - o.limitPrice / o.marketAtPlacement)),
    hoursToFill: meanOf(filled.filter((o) => o.closedAt != null).map((o) => (o.closedAt! - o.placedAt) / 3600000)),
    missed: meanOf(expired.filter((o) => o.priceAtClose != null).map((o) => o.priceAtClose! / o.marketAtPlacement - 1)),
  };
};

// ===== Real against paper =====

/** Pounds per BTC, fees included, over buys from `since`. Other-currency buys use their own day's rate, or today's. */
const avgPaid = (trades: Trade[], since: number, live: LivePrices): AvgPaid | null => {
  let money = 0;
  let btc = 0;
  let buys = 0;
  for (const t of trades) {
    if (t.side !== 'buy' || t.time < since) continue;
    const gbp = toGbpThen(t.fiat, t.currency, t.marketPriceUsd, t.marketPriceGbp) ?? convert(t.fiat, t.currency, 'GBP', live);
    money += gbp;
    btc += t.btc;
    buys++;
  }
  return buys && btc > 0 ? { buys, avgPrice: money / btc } : null;
};

// ===== The scorecard =====

/** When paper trading began: the first decision of any kind. */
export const paperStart = (b: PaperBook): number | null => {
  const times = [...b.trades.map((t) => t.time), ...b.orders.map((o) => o.placedAt), ...b.skips.map((s) => s.time)];
  return times.length ? Math.min(...times) : null;
};

export const scorePaper = (b: PaperBook, realTrades: Trade[] = [], live: LivePrices = { usd: 0, gbp: 0 }): PaperScorecard => {
  const buys = b.trades.filter((t) => t.side === 'buy');
  const since = paperStart(b);
  const calls = briefDecisions(b);

  let realVsPaper: RealVsPaper | null = null;
  if (since != null) {
    const real = avgPaid(realTrades, since, live);
    const paper = avgPaid(b.trades, since, live);
    if (real && paper) realVsPaper = { since, real, paper, diffPct: ((real.avgPrice - paper.avgPrice) / paper.avgPrice) * 100 };
  }

  return {
    since,
    // A filled order and its trade are one decision.
    decisions: b.trades.filter((t) => !t.paper.orderId).length + b.orders.length + b.skips.length,
    buys: buys.length,
    sells: b.trades.length - buys.length,
    skips: b.skips.length,
    vsFlat: compareWithFlat(b),
    bySource: groupBuys(buys, (t) => t.paper.advice, ADVICE_SOURCES, (k: AdviceSource) => ADVICE_LABEL[k]),
    byScenario: groupBuys(buys, (t) => t.paper.scenario, SCENARIOS, (k: Scenario) => SCENARIO_LABEL[k]),
    byTier: groupBuys(buys, (t) => t.signal?.action ?? null, TIERS, (k: Action) => ACTION_LABEL[k]),
    byVsApp: groupBuys(buys, (t) => compareWithApp(t.fiat, t.paper.suggestedAmount), VS_APP, (k: VsApp) => VS_APP_LABEL[k]),
    calibration: calibrate(calls),
    verdicts: verdictGroups(calls),
    orders: orderStats(b),
    realVsPaper,
  };
};

// ===== In plain English =====

const tooFew = (n: number, min: number) => (n < min ? ` Too few to judge yet: it takes ${min} or more.` : '');

/**
 * The scorecard's main findings as sentences, each with its sample size and a
 * warning when it is too small to mean much. Only findings with data appear.
 */
export const paperHeadlines = (c: PaperScorecard): string[] => {
  const out: string[] = [];

  if (c.vsFlat) {
    const v = c.vsFlat;
    out.push(
      `Your paper buys got Bitcoin ${Math.abs(v.advantagePct).toFixed(1)}% ${v.advantagePct >= 0 ? 'cheaper' : 'dearer'} ` +
        `than putting the same ${formatMoney(v.invested, 'GBP')} in evenly over the same ${v.days} days ` +
        `(${formatMoney(v.adviceAvgCost, 'GBP')} against ${formatMoney(v.flatAvgCost, 'GBP')} per BTC, before fees).` +
        tooFew(v.days, MIN_DAYS)
    );
  }

  const same = c.byVsApp.find((g) => g.key === 'same');
  const other = c.byVsApp.filter((g) => g.key !== 'same');
  const otherN = other.reduce((a, g) => a + g.after30d.n, 0);
  if (same?.after30d.mean != null && otherN > 0) {
    const otherMean = other.reduce((a, g) => a + (g.after30d.mean ?? 0) * g.after30d.n, 0) / otherN;
    out.push(
      `30 days on, buys that matched the app's amount were followed by ${formatPct(same.after30d.mean)} on average ` +
        `(${same.after30d.n}), and buys that did not by ${formatPct(otherMean)} (${otherN}).` +
        tooFew(Math.min(same.after30d.n, otherN), MIN_GROUP)
    );
  }

  // One line for Claude's chances, pooled over the horizons; the table on
  // the card breaks it down by horizon.
  const scored = c.calibration.filter((cal) => cal.n > 0 && cal.brier != null);
  if (scored.length) {
    const checks = scored.reduce((a, cal) => a + cal.n, 0);
    const brier = scored.reduce((a, cal) => a + cal.brier! * cal.n, 0) / checks;
    const calls = Math.max(...scored.map((cal) => cal.n));
    out.push(
      `Claude's chances of a lower price have been checked ${checks} time${checks === 1 ? '' : 's'} ` +
        `(${scored.map((cal) => cal.label).join(', ')} after each call). They score ${brier.toFixed(3)}, against 0.250 ` +
        `for always saying 50%: ${brier < 0.25 ? 'better' : brier > 0.25 ? 'worse' : 'no better'} than a coin flip so far ` +
        `(lower is better).` +
        tooFew(calls, MIN_CALLS)
    );
  }

  const o = c.orders;
  if (o.filled + o.expired > 0) {
    let line = `${o.filled} of ${o.filled + o.expired} limit orders filled`;
    if (o.saving.mean != null) line += `, buying ${(o.saving.mean * 100).toFixed(1)}% below the price when placed`;
    if (o.missed.mean != null && o.missed.n > 0) {
      const one = o.missed.n === 1;
      const m = o.missed.mean;
      line +=
        `. ${one ? 'The one' : `The ${o.missed.n}`} that ran out finished with the price ` +
        `${Math.abs(m * 100).toFixed(1)}% ${m >= 0 ? 'above' : 'below'} where ${one ? 'it was' : 'they were'} placed` +
        (one ? '' : ', on average');
    }
    out.push(`${line}.`);
  }

  if (c.realVsPaper) {
    const r = c.realVsPaper;
    out.push(
      `Since paper trading began, your real buys paid ${formatMoney(r.real.avgPrice, 'GBP')} per BTC on average (${r.real.buys}) ` +
        `and your paper buys ${formatMoney(r.paper.avgPrice, 'GBP')} (${r.paper.buys}), fees included.` +
        tooFew(Math.min(r.real.buys, r.paper.buys), MIN_GROUP)
    );
  }

  return out;
};

// ===== As plain text, for Claude =====

const pctText = (m: Mean) => (m.mean == null ? '…' : `${formatPct(m.mean)} (${m.n})`);
const groupLines = (title: string, groups: OutcomeGroup[]): string[] =>
  groups.length
    ? [
        `${title} (buys; average BTC/USD move after 7 and 30 days, with how many buys had one):`,
        ...groups.map(
          (g) => `  ${g.label}: ${g.buys} buy${g.buys === 1 ? '' : 's'}, 7d ${pctText(g.after7d)}, 30d ${pctText(g.after30d)}${g.buys < MIN_GROUP ? '  [too few]' : ''}`
        ),
      ]
    : [];

/**
 * The scorecard as plain text, exactly as the app works it out, for
 * /paper-review. `yarn paper-review` prints it from an exported backup, so a
 * review in Claude starts from the same figures the phone shows.
 */
export const paperReviewReport = (c: PaperScorecard): string => {
  const o = c.orders;
  const headlines = paperHeadlines(c);
  const lines: string[] = [
    'PAPER RECORD SCORECARD (the app\'s own figures)',
    `Since: ${c.since != null ? new Date(c.since).toISOString().slice(0, 10) : 'no decisions yet'}`,
    `Decisions: ${c.decisions} (${c.buys} buys, ${c.sells} sells, ${c.skips} decisions not to buy, ${o.placed} limit orders)`,
    `Thresholds: ${MIN_GROUP} buys per group, ${MIN_DAYS} days for the even-spread comparison, ${MIN_CALLS} calls for Claude's chances.`,
    '',
    'Findings:',
    ...(headlines.length ? headlines.map((h) => `- ${h}`) : ['- None yet: results appear as the days pass.']),
  ];
  for (const [title, groups] of [
    ['Whose call', c.bySource],
    ['Why then', c.byScenario],
    ['Signal then', c.byTier],
    ['Against the app', c.byVsApp],
  ] as const) {
    const g = groupLines(title, groups);
    if (g.length) lines.push('', ...g);
  }
  const scored = c.calibration.filter((cal) => cal.n > 0);
  if (scored.length) {
    lines.push('', "Claude's chances of a lower price (score: lower is better, 0.250 = always saying 50%):");
    for (const cal of scored) {
      lines.push(
        `  ${cal.label}: ${cal.n} call${cal.n === 1 ? '' : 's'}, said ${Math.round((cal.meanForecast ?? 0) * 100)}% on average, ` +
          `was lower ${Math.round((cal.lowerRate ?? 0) * 100)}%, score ${cal.brier?.toFixed(3)}${cal.n < MIN_CALLS ? '  [too few]' : ''}`
      );
    }
  }
  if (c.verdicts.length) {
    lines.push('', "Claude's verdicts (average BTC/USD move after the decision):");
    for (const v of c.verdicts) lines.push(`  ${v.label}: ${v.n} call${v.n === 1 ? '' : 's'}, 24h ${pctText(v.after24h)}, 7d ${pctText(v.after7d)}`);
  }
  if (o.placed) {
    lines.push(
      '',
      `Limit orders: ${o.placed} placed, ${o.filled} filled, ${o.expired} ran out, ${o.cancelled} cancelled, ${o.lapsed} could not be checked, ${o.open} waiting.`
    );
    if (o.fillRate != null) lines.push(`  Fill rate ${Math.round(o.fillRate * 100)}% of those that filled or ran out.`);
    if (o.saving.mean != null) lines.push(`  Filled ones bought ${(o.saving.mean * 100).toFixed(2)}% below the price when placed, on average (${o.saving.n}).`);
    if (o.hoursToFill.mean != null) lines.push(`  They took ${o.hoursToFill.mean.toFixed(1)} hours to fill, on average.`);
    if (o.missed.mean != null) lines.push(`  Ones that ran out finished ${formatPct(o.missed.mean)} from the price when placed, on average (${o.missed.n}).`);
  }
  return lines.join('\n') + '\n';
};
