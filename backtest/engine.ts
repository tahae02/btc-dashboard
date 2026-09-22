/**
 * Bar-by-bar backtest engine.
 *
 * ---------------------------------------------------------------------------
 * The one rule that makes a backtest worth reading: no lookahead
 * ---------------------------------------------------------------------------
 * A strategy is handed a trailing window ending at bar `i` and nothing else.
 * It cannot see bar `i + 1`. Its decision is then executed at the OPEN of bar
 * `i + 1`, because in real life you observe a close and the earliest you can
 * act is the next bar. Getting this wrong is the single most common reason a
 * backtest looks brilliant and then loses money: if you let the strategy trade
 * at the close it just used to decide, you are trading on information you did
 * not have. `__tests__/backtest.test.ts` enforces this by rewriting future
 * bars and asserting that past decisions do not move.
 *
 * ---------------------------------------------------------------------------
 * Costs are charged, always
 * ---------------------------------------------------------------------------
 * Every rebalance pays a fee and crosses the spread. Plenty of strategies that
 * beat buy-and-hold on paper are net losers once you charge them 0.4% a
 * round trip, so costs are on by default and the report shows what they took.
 *
 * ---------------------------------------------------------------------------
 * Contributions are identical across strategies
 * ---------------------------------------------------------------------------
 * In DCA mode the same money arrives on the same schedule for every strategy.
 * What differs is only how fast it is converted into Bitcoin. That keeps the
 * comparison against flat DCA honest: nobody gets to win by contributing more.
 */
import type { OHLCVCandle } from '../src/types';
import type { EquityPoint, Metrics } from './metrics';
import { computeMetrics } from './metrics';

/** Window of history a strategy may look at. Ends at the current bar. */
export interface StrategyContext {
  /** Trailing closed bars, oldest first, ending at the decision bar. */
  history: OHLCVCandle[];
  /** Current portfolio allocation, 0..1. */
  currentAllocation: number;
}

export interface Strategy {
  name: string;
  description: string;
  /** Desired fraction of the portfolio in BTC, 0..1. */
  targetAllocation: (ctx: StrategyContext) => number;
  /** Minimum drift before trading. Defaults to the engine's band. */
  rebalanceBand?: number;
}

export interface BacktestOptions {
  candles: OHLCVCandle[];
  strategy: Strategy;
  /** 'lump': all capital at the start. 'dca': fixed amount on a schedule. */
  mode: 'lump' | 'dca';
  initialCapital: number;
  contribution: number;
  contributionEveryDays: number;
  /** Exchange fee per trade, as a percent of notional. */
  feePct: number;
  /** Half-spread paid on entry and exit, as a percent. */
  slippagePct: number;
  /** Bars of history required before the strategy is allowed to trade. */
  warmup: number;
  /** How many trailing bars the strategy may see. Caps cost and lookahead. */
  windowSize: number;
  rebalanceBand: number;
}

export const DEFAULT_OPTIONS: Omit<BacktestOptions, 'candles' | 'strategy'> = {
  mode: 'dca',
  initialCapital: 1000,
  contribution: 250,
  contributionEveryDays: 30,
  feePct: 0.26,      // Kraken taker fee at the lowest volume tier
  slippagePct: 0.05,
  warmup: 220,       // SMA200 plus a little settling room
  windowSize: 400,
  rebalanceBand: 0.15,
};

export interface BacktestResult {
  strategy: string;
  description: string;
  metrics: Metrics;
  equity: EquityPoint[];
}

export const runBacktest = (opts: BacktestOptions): BacktestResult => {
  const { candles, strategy, mode, feePct, slippagePct, warmup, windowSize } = opts;
  const band = strategy.rebalanceBand ?? opts.rebalanceBand;

  if (candles.length < warmup + 10) {
    throw new Error(`Need at least ${warmup + 10} bars, got ${candles.length}.`);
  }

  let cash = 0;
  let btc = 0;
  let contributed = 0;
  let rebalances = 0;
  let feesPaid = 0;
  const equity: EquityPoint[] = [];
  const cashflows: { time: number; amount: number }[] = [];

  const startBar = candles[warmup]!;
  const contribute = (amount: number, time: number) => {
    if (amount <= 0) return;
    cash += amount;
    contributed += amount;
    cashflows.push({ time, amount: -amount });
  };

  contribute(opts.initialCapital, startBar.time);
  let lastContribution = startBar.time;

  // Decide on bar i, execute on bar i + 1. The loop therefore stops one short.
  for (let i = warmup; i < candles.length - 1; i++) {
    const next = candles[i + 1]!;

    // New money arrives before the decision, so it can be deployed this bar.
    if (mode === 'dca') {
      while (next.time - lastContribution >= opts.contributionEveryDays * 86400000) {
        lastContribution += opts.contributionEveryDays * 86400000;
        contribute(opts.contribution, lastContribution);
      }
    }

    const markPrice = candles[i]!.close;
    const valueNow = cash + btc * markPrice;
    const currentAllocation = valueNow > 0 ? (btc * markPrice) / valueNow : 0;

    // The strategy sees a trailing window ending at bar i. Never bar i + 1.
    const history = candles.slice(Math.max(0, i - windowSize + 1), i + 1);
    const target = Math.min(1, Math.max(0, strategy.targetAllocation({ history, currentAllocation })));

    if (Math.abs(target - currentAllocation) > band) {
      // Execute at the next bar's open, with the spread paid in the direction
      // that hurts: you buy a touch above and sell a touch below.
      const openValue = cash + btc * next.open;
      const desiredBtcValue = openValue * target;
      const deltaValue = desiredBtcValue - btc * next.open;

      if (Math.abs(deltaValue) > 0.01) {
        const buying = deltaValue > 0;
        const execPrice = next.open * (1 + (buying ? slippagePct : -slippagePct) / 100);
        const notional = Math.abs(deltaValue);
        const fee = (notional * feePct) / 100;

        if (buying) {
          const spend = Math.min(notional, Math.max(0, cash - fee));
          if (spend > 0) {
            btc += spend / execPrice;
            cash -= spend + fee;
            feesPaid += fee;
            rebalances++;
          }
        } else {
          const sellValue = Math.min(notional, btc * execPrice);
          if (sellValue > 0) {
            btc -= sellValue / execPrice;
            cash += sellValue - fee;
            feesPaid += fee;
            rebalances++;
          }
        }
      }
    }

    const closeValue = cash + btc * next.close;
    equity.push({
      time: next.time,
      value: closeValue,
      allocation: closeValue > 0 ? (btc * next.close) / closeValue : 0,
      contributed,
    });
  }

  return {
    strategy: strategy.name,
    description: strategy.description,
    metrics: computeMetrics(equity, cashflows, rebalances, feesPaid),
    equity,
  };
};
