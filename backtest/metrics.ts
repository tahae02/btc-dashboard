/**
 * Performance metrics.
 *
 * Total return alone is close to useless for judging a strategy: a rule that
 * doubles your money while spending six months 80% underwater is not the same
 * product as one that doubles it smoothly, and you will not hold the first one
 * through the drawdown. So drawdown and risk-adjusted measures are reported
 * alongside return, and every strategy is compared against the two benchmarks
 * that actually compete for the money: buy-and-hold, and flat DCA.
 */

export interface EquityPoint {
  time: number;
  /** Portfolio value including cash. */
  value: number;
  /** Fraction of the portfolio held in BTC at this bar. */
  allocation: number;
  /** Cumulative money put in (DCA mode). Equals the initial stake in lump mode. */
  contributed: number;
}

export interface Metrics {
  finalValue: number;
  contributed: number;
  /** Final value / total contributed. */
  multiple: number;
  /** Time-weighted annual growth of the portfolio value (lump-sum mode). */
  cagrPct: number;
  /** Money-weighted annual return. The honest number when contributions vary. */
  irrPct: number;
  maxDrawdownPct: number;
  /** Longest stretch, in days, spent below a previous peak. */
  longestDrawdownDays: number;
  annualVolPct: number;
  sharpe: number;
  sortino: number;
  /** CAGR divided by max drawdown. How much pain per unit of return. */
  calmar: number;
  avgAllocationPct: number;
  rebalances: number;
  feesPaid: number;
  years: number;
}

const DAYS_PER_YEAR = 365.25;

export const maxDrawdown = (values: number[]): number => {
  let peak = -Infinity;
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.min(worst, v / peak - 1);
  }
  return worst * 100;
};

export const longestDrawdownDays = (points: EquityPoint[]): number => {
  let peak = -Infinity;
  let peakTime = points[0]?.time ?? 0;
  let longest = 0;
  let underwater = false;
  for (const p of points) {
    if (p.value >= peak) {
      // Recovery closes the episode, and the bar that reaches a new high is
      // part of its duration. Measuring only up to the last underwater bar
      // (as this did before) systematically under-reports how long you spent
      // waiting to get back to even, which is the number that decides whether
      // you can actually live with a strategy.
      if (underwater) longest = Math.max(longest, (p.time - peakTime) / 86400000);
      peak = p.value;
      peakTime = p.time;
      underwater = false;
    } else {
      underwater = true;
      longest = Math.max(longest, (p.time - peakTime) / 86400000);
    }
  }
  return Math.round(longest);
};

/**
 * Money-weighted annualised return, by bisection on the discount rate.
 *
 * Cashflows are negative when money goes in and positive for the final value.
 * This is the number that answers "what did MY money actually earn", which
 * time-weighted CAGR does not when contributions are spread over time.
 */
export const irr = (cashflows: { time: number; amount: number }[]): number => {
  if (cashflows.length < 2) return 0;
  const t0 = cashflows[0]!.time;
  const npv = (rate: number): number =>
    cashflows.reduce((acc, cf) => {
      const years = (cf.time - t0) / 86400000 / DAYS_PER_YEAR;
      return acc + cf.amount / Math.pow(1 + rate, years);
    }, 0);

  let lo = -0.9999;
  let hi = 10;
  if (npv(lo) * npv(hi) > 0) return 0; // no sign change, IRR undefined
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return ((lo + hi) / 2) * 100;
};

export const computeMetrics = (
  points: EquityPoint[],
  cashflows: { time: number; amount: number }[],
  rebalances: number,
  feesPaid: number
): Metrics => {
  if (points.length < 2) {
    return {
      finalValue: 0, contributed: 0, multiple: 0, cagrPct: 0, irrPct: 0,
      maxDrawdownPct: 0, longestDrawdownDays: 0, annualVolPct: 0, sharpe: 0,
      sortino: 0, calmar: 0, avgAllocationPct: 0, rebalances, feesPaid, years: 0,
    };
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const years = (last.time - first.time) / 86400000 / DAYS_PER_YEAR;
  const values = points.map((p) => p.value);

  // Daily returns of the portfolio itself. Contributions are stripped out so
  // that adding money is not mistaken for performance.
  const rets: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const added = cur.contributed - prev.contributed;
    const base = prev.value + added;
    if (base > 0) rets.push(cur.value / base - 1);
  }

  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length > 1
    ? rets.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / (rets.length - 1)
    : 0;
  const sd = Math.sqrt(variance);
  const downside = rets.filter((r) => r < 0);
  const downsideSd = downside.length > 1
    ? Math.sqrt(downside.reduce((a, r) => a + r * r, 0) / downside.length)
    : 0;

  const annualVol = sd * Math.sqrt(DAYS_PER_YEAR);
  const sharpe = sd > 0 ? (mean * DAYS_PER_YEAR) / annualVol : 0;
  const sortino = downsideSd > 0 ? (mean * DAYS_PER_YEAR) / (downsideSd * Math.sqrt(DAYS_PER_YEAR)) : 0;

  // Time-weighted CAGR is only meaningful when the stake went in at the start.
  // With ongoing contributions, read irrPct instead.
  const cagr = years > 0 && first.value > 0 ? (Math.pow(last.value / first.value, 1 / years) - 1) * 100 : 0;
  const dd = maxDrawdown(values);

  return {
    finalValue: last.value,
    contributed: last.contributed,
    multiple: last.contributed > 0 ? last.value / last.contributed : 0,
    cagrPct: cagr,
    irrPct: irr([...cashflows, { time: last.time, amount: last.value }]),
    maxDrawdownPct: dd,
    longestDrawdownDays: longestDrawdownDays(points),
    annualVolPct: annualVol * 100,
    sharpe,
    sortino,
    calmar: dd !== 0 ? cagr / Math.abs(dd) : 0,
    avgAllocationPct: (points.reduce((a, p) => a + p.allocation, 0) / points.length) * 100,
    rebalances,
    feesPaid,
    years,
  };
};
