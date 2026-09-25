/**
 * Track record: how the engine's calls have played out.
 *
 * Two sources, scored the same way:
 *
 *   - REPLAY. The engine re-run on each past day of the daily history the app
 *     already downloads (Kraken returns ~720 days), seeing only candles that
 *     had closed by then. This gives an answer on day one instead of after
 *     months of waiting, but it is the engine grading itself on a period its
 *     defaults were chosen against, so it is a sanity check, not proof.
 *   - LIVE LOG. The signal the app actually showed, one entry per day, saved
 *     as you use the app. This is the honest out-of-sample record, and it
 *     fills up slowly.
 *
 * What is measured, and why these things
 * --------------------------------------
 * The engine outputs an ALLOCATION for someone accumulating over years. It
 * does not predict tomorrow's price, so "was it right after 24 hours?" is not
 * a question it makes a claim about. What it does claim, and what can be
 * checked:
 *
 *   1. Higher tiers should be followed by better returns than lower tiers,
 *      and than an average day, over the weeks-to-months it is built for.
 *   2. Scaling contributions by the DCA multiplier should buy Bitcoin more
 *      cheaply per pound than a flat amount.
 *   3. The 24h and 7d ranges say "roughly two thirds of periods land inside".
 *      That is a checkable number.
 *
 * Consecutive days overlap heavily (a 30-day return starting today shares 29
 * days with tomorrow's), so N days is nowhere near N independent results.
 * `independentPeriods` reports the honest count.
 */
import type { Action, OHLCVCandle, SignalConfig } from '../types';
import { computeIndicators } from './indicators';
import { computeSignal, DEFAULT_CONFIG } from './signalEngine';
import type { SignalStamp } from './journal';

const DAY = 24 * 60 * 60 * 1000;

/** Bars needed before a replayed day looks like the live signal: SMA200 plus its 20-bar slope. */
export const REPLAY_WARMUP = 221;
/** Trailing bars the engine sees per day, as in the backtester. */
const WINDOW = 400;

export const TIERS: Action[] = ['ACCUMULATE_STRONG', 'ACCUMULATE', 'HOLD', 'REDUCE', 'EXIT'];
export const SCORE_HORIZONS = [7, 30, 90] as const;
export type ScoreHorizon = (typeof SCORE_HORIZONS)[number];

/** One day's call, in the form both replay and live log are scored from. */
export interface DayCall {
  /** Open time of the last CLOSED daily bar the call was made from. */
  day: number;
  action: Action;
  targetAllocation: number;
  dcaMultiplier: number;
  conviction: number;
  regimeScore: number;
  /** ATR at the time, for checking the range claims. */
  atr: number | null;
}

// ===== Replay =====

/** Index of the last daily bar that had closed by `t`, or -1. */
export const lastClosedIndex = (daily: OHLCVCandle[], t: number): number => {
  let lo = 0;
  let hi = daily.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (daily[mid]!.time + DAY <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
};

/**
 * The engine's call as of the close of `daily[i]`, using only bars up to and
 * including `i`. Null during warm-up.
 */
export const callOnDay = (daily: OHLCVCandle[], i: number, config: SignalConfig = DEFAULT_CONFIG): DayCall | null => {
  if (i < REPLAY_WARMUP - 1 || i >= daily.length) return null;
  const window = daily.slice(Math.max(0, i - WINDOW + 1), i + 1);
  const indicators = computeIndicators(window);
  const close = daily[i]!.close;
  const s = computeSignal({ indicators, currentPrice: close, fearGreed: null, config });
  return {
    day: daily[i]!.time,
    action: s.action,
    targetAllocation: s.targetAllocation,
    dcaMultiplier: s.dcaMultiplier,
    conviction: s.conviction,
    regimeScore: s.regimeScore,
    atr: indicators.atr,
  };
};

/** Replay days [from, to). Chunkable, so a phone can spread it over frames. */
export const replayCalls = (
  daily: OHLCVCandle[],
  from: number,
  to: number,
  config: SignalConfig = DEFAULT_CONFIG
): DayCall[] => {
  const out: DayCall[] = [];
  for (let i = Math.max(from, REPLAY_WARMUP - 1); i < Math.min(to, daily.length); i++) {
    const c = callOnDay(daily, i, config);
    if (c) out.push(c);
  }
  return out;
};

/** Stamp for a back-dated trade: the call as of the last bar closed before it. */
export const reconstructStamp = (
  daily: OHLCVCandle[],
  tradeTime: number,
  config: SignalConfig = DEFAULT_CONFIG
): SignalStamp | null => {
  const c = callOnDay(daily, lastClosedIndex(daily, tradeTime), config);
  return c
    ? {
        action: c.action,
        targetAllocation: c.targetAllocation,
        dcaMultiplier: c.dcaMultiplier,
        conviction: c.conviction,
        regimeScore: c.regimeScore,
        fearGreed: null,
        source: 'reconstructed',
      }
    : null;
};

// ===== Scoring =====

export interface HorizonStats {
  /** Days with a known outcome at this horizon. */
  n: number;
  /** Mean fractional return. */
  mean: number | null;
  /** Share of outcomes that were positive. */
  upRate: number | null;
}

export interface TierStats {
  action: Action;
  days: number;
  byHorizon: Record<ScoreHorizon, HorizonStats>;
  /** Non-overlapping 30-day periods this tier covers. The honest sample size. */
  independentPeriods: number;
}

export interface RangeCheck {
  n: number;
  inside: number;
  rate: number | null;
}

export interface DcaComparison {
  weeks: number;
  /** Average price per BTC buying a flat amount every week. */
  flatAvgCost: number;
  /** Average price per BTC buying `multiplier` x that amount every week. */
  signalAvgCost: number;
  /** Positive: the multiplier bought more cheaply per unit of money invested. */
  advantagePct: number;
  /** Money the multiplier put in, relative to flat (1.0 = the same). */
  investedRatio: number;
}

export interface TrackRecord {
  days: number;
  from: number | null;
  to: number | null;
  baseline: Record<ScoreHorizon, HorizonStats>;
  tiers: TierStats[];
  dca: DcaComparison | null;
  range1d: RangeCheck;
  range7d: RangeCheck;
}

const emptyHorizons = (): Record<ScoreHorizon, { sum: number; n: number; up: number }> =>
  ({ 7: { sum: 0, n: 0, up: 0 }, 30: { sum: 0, n: 0, up: 0 }, 90: { sum: 0, n: 0, up: 0 } });

const finish = (acc: ReturnType<typeof emptyHorizons>): Record<ScoreHorizon, HorizonStats> =>
  Object.fromEntries(
    SCORE_HORIZONS.map((h) => [h, { n: acc[h].n, mean: acc[h].n ? acc[h].sum / acc[h].n : null, upRate: acc[h].n ? acc[h].up / acc[h].n : null }])
  ) as Record<ScoreHorizon, HorizonStats>;

/**
 * Score calls against the daily closes that followed them.
 *
 * Every return is measured from the close of the call's own bar, which is the
 * last price the call could have known, to the close `h` days later.
 */
export const scoreCalls = (calls: DayCall[], daily: OHLCVCandle[]): TrackRecord => {
  const closeByDay = new Map<number, number>();
  for (const c of daily) if (c.close > 0) closeByDay.set(c.time, c.close);
  const closeAt = (t: number) => closeByDay.get(t) ?? null;

  const sorted = [...calls].filter((c) => closeAt(c.day) != null).sort((a, b) => a.day - b.day);
  const base = emptyHorizons();
  const perTier = new Map<Action, { days: number; acc: ReturnType<typeof emptyHorizons> }>();
  const range1d: RangeCheck = { n: 0, inside: 0, rate: null };
  const range7d: RangeCheck = { n: 0, inside: 0, rate: null };

  for (const call of sorted) {
    const p0 = closeAt(call.day)!;
    const tier = perTier.get(call.action) ?? { days: 0, acc: emptyHorizons() };
    tier.days++;
    perTier.set(call.action, tier);

    for (const h of SCORE_HORIZONS) {
      const p1 = closeAt(call.day + h * DAY);
      if (p1 == null) continue;
      const r = p1 / p0 - 1;
      for (const acc of [base, tier.acc]) {
        acc[h].sum += r;
        acc[h].n++;
        if (r > 0) acc[h].up++;
      }
    }

    if (call.atr != null && call.atr > 0) {
      const next = closeAt(call.day + DAY);
      if (next != null) {
        range1d.n++;
        if (Math.abs(next - p0) <= call.atr) range1d.inside++;
      }
      const week = closeAt(call.day + 7 * DAY);
      if (week != null) {
        range7d.n++;
        if (Math.abs(week - p0) <= call.atr * Math.sqrt(7)) range7d.inside++;
      }
    }
  }
  range1d.rate = range1d.n ? range1d.inside / range1d.n : null;
  range7d.rate = range7d.n ? range7d.inside / range7d.n : null;

  const tiers: TierStats[] = TIERS.filter((a) => perTier.has(a)).map((a) => {
    const t = perTier.get(a)!;
    return { action: a, days: t.days, byHorizon: finish(t.acc), independentPeriods: Math.floor(t.days / 30) };
  });

  return {
    days: sorted.length,
    from: sorted[0]?.day ?? null,
    to: sorted[sorted.length - 1]?.day ?? null,
    baseline: finish(base),
    tiers,
    dca: compareDca(sorted, closeAt),
    range1d,
    range7d,
  };
};

/**
 * Weekly DCA, flat vs scaled by the multiplier, bought at each week's close.
 *
 * Compared per unit of money actually invested, because the scaled version
 * invests a different total. Without that, "more BTC" could just mean "more
 * money", which says nothing about timing.
 */
const compareDca = (calls: DayCall[], closeAt: (t: number) => number | null): DcaComparison | null => {
  let flatMoney = 0;
  let flatBtc = 0;
  let sigMoney = 0;
  let sigBtc = 0;
  let weeks = 0;
  let next = calls[0]?.day ?? 0;
  for (const c of calls) {
    if (c.day < next) continue;
    const p = closeAt(c.day);
    if (!p) continue;
    flatMoney += 1;
    flatBtc += 1 / p;
    sigMoney += c.dcaMultiplier;
    sigBtc += c.dcaMultiplier / p;
    weeks++;
    next = c.day + 7 * DAY;
  }
  if (weeks < 4 || flatBtc <= 0 || sigBtc <= 0) return null;
  const flatAvgCost = flatMoney / flatBtc;
  const signalAvgCost = sigMoney / sigBtc;
  return {
    weeks,
    flatAvgCost,
    signalAvgCost,
    advantagePct: ((flatAvgCost - signalAvgCost) / flatAvgCost) * 100,
    investedRatio: sigMoney / flatMoney,
  };
};

// ===== Live log =====

export const SIGNAL_LOG_KEY = 'btc_dashboard_signal_log_v1';
/** About three years of daily entries. */
export const SIGNAL_LOG_MAX = 1100;

export interface LoggedCall extends DayCall {
  loggedAt: number;
  fearGreed: number | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const parseSignalLog = (raw: string | null): LoggedCall[] => {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const byDay = new Map<number, LoggedCall>();
  for (const e of data as any[]) {
    if (!e || !isNum(e.day) || !TIERS.includes(e.action)) continue;
    if (![e.targetAllocation, e.dcaMultiplier, e.conviction, e.regimeScore, e.loggedAt].every(isNum)) continue;
    if (!byDay.has(e.day)) {
      byDay.set(e.day, {
        day: e.day,
        action: e.action,
        targetAllocation: e.targetAllocation,
        dcaMultiplier: e.dcaMultiplier,
        conviction: e.conviction,
        regimeScore: e.regimeScore,
        atr: isNum(e.atr) ? e.atr : null,
        loggedAt: e.loggedAt,
        fearGreed: isNum(e.fearGreed) ? e.fearGreed : null,
      });
    }
  }
  return [...byDay.values()].sort((a, b) => a.day - b.day);
};

/**
 * Record today's call. One entry per closed daily bar, and the FIRST one
 * seen is kept: later opens the same day see a slightly different live
 * price, and keeping the first makes the log a record of what you were
 * first shown rather than whatever happened to be on screen last.
 * Returns the same array when nothing changed, so callers can skip a write.
 */
export const appendToLog = (log: LoggedCall[], entry: LoggedCall, max: number = SIGNAL_LOG_MAX): LoggedCall[] => {
  if (log.some((e) => e.day === entry.day)) return log;
  const next = [...log, entry].sort((a, b) => a.day - b.day);
  return next.length > max ? next.slice(next.length - max) : next;
};
