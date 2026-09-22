import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest, DEFAULT_OPTIONS } from '../backtest/engine';
import type { Strategy } from '../backtest/engine';
import { buyAndHold, sma200Filter, signalEngineStrategy } from '../backtest/strategies';
import { DEFAULT_CONFIG } from '../src/services/signalEngine';
import { generateSyntheticSeries, parseCsv, toCsv } from '../backtest/data';
import { maxDrawdown, irr, computeMetrics } from '../backtest/metrics';
import type { EquityPoint } from '../backtest/metrics';
import type { OHLCVCandle } from '../src/types';

const DATA = generateSyntheticSeries(900, 12345);

const opts = (strategy: Strategy, over: Partial<typeof DEFAULT_OPTIONS> = {}) => ({
  ...DEFAULT_OPTIONS,
  ...over,
  candles: DATA,
  strategy,
});

describe('no lookahead', () => {
  /**
   * THE test. If a strategy can see the bar it is about to trade on, the
   * backtest becomes a fantasy: results look excellent and the live system
   * loses money. This rewrites all bars after a cut point with wildly
   * different prices and asserts that every decision taken before the cut is
   * byte-identical. If any future information leaks into the decision path,
   * these two runs diverge.
   */
  const recordingStrategy = (log: { bar: number; lastClose: number; target: number }[]): Strategy => {
    let bar = 0;
    return {
      name: 'recorder',
      description: 'records what it saw',
      targetAllocation: ({ history }) => {
        const closes = history.map((c) => c.close);
        const target = closes.length >= 200 ? (closes[closes.length - 1]! > closes[closes.length - 200]! ? 1 : 0) : 0.5;
        log.push({ bar: bar++, lastClose: closes[closes.length - 1]!, target });
        return target;
      },
    };
  };

  test('decisions before a cut point ignore everything after it', () => {
    const cut = 500;
    const tampered: OHLCVCandle[] = DATA.map((c, i) =>
      i <= cut ? c : { ...c, open: c.open * 50, high: c.high * 50, low: c.low * 50, close: c.close * 50 }
    );

    const logA: { bar: number; lastClose: number; target: number }[] = [];
    const logB: { bar: number; lastClose: number; target: number }[] = [];
    runBacktest({ ...DEFAULT_OPTIONS, candles: DATA, strategy: recordingStrategy(logA) });
    runBacktest({ ...DEFAULT_OPTIONS, candles: tampered, strategy: recordingStrategy(logB) });

    // Decisions are taken from bar `warmup` onwards, so compare the overlap.
    const comparable = cut - DEFAULT_OPTIONS.warmup;
    assert.ok(comparable > 50, 'need a meaningful overlap to test');
    for (let i = 0; i < comparable; i++) {
      assert.equal(logB[i]!.lastClose, logA[i]!.lastClose, `bar ${i}: strategy saw different data`);
      assert.equal(logB[i]!.target, logA[i]!.target, `bar ${i}: decision changed`);
    }
  });

  test('the strategy never receives the bar it will trade on', () => {
    const seen: number[] = [];
    const spy: Strategy = {
      name: 'spy',
      description: '',
      targetAllocation: ({ history }) => {
        seen.push(history[history.length - 1]!.time);
        return 1;
      },
    };
    runBacktest(opts(spy));
    // First decision is taken on bar `warmup` and executed on `warmup + 1`.
    assert.equal(seen[0], DATA[DEFAULT_OPTIONS.warmup]!.time);
    // The last decision is on the penultimate bar, never the final one.
    assert.equal(seen[seen.length - 1], DATA[DATA.length - 2]!.time);
    assert.ok(!seen.includes(DATA[DATA.length - 1]!.time), 'strategy saw the final bar it trades into');
  });

  test('the history window ends at the decision bar and never runs ahead', () => {
    const violations: string[] = [];
    let idx = DEFAULT_OPTIONS.warmup;
    const checker: Strategy = {
      name: 'checker',
      description: '',
      targetAllocation: ({ history }) => {
        const expected = DATA[idx]!.time;
        if (history[history.length - 1]!.time !== expected) violations.push(`bar ${idx}`);
        if (history.some((c) => c.time > expected)) violations.push(`bar ${idx} contains future data`);
        idx++;
        return 1;
      },
    };
    runBacktest(opts(checker));
    assert.deepEqual(violations, []);
  });
});

describe('execution mechanics', () => {
  test('trades execute at the next open, not the close just observed', () => {
    // Enter on the very first opportunity, then hold.
    const enterOnce: Strategy = { name: 'enter', description: '', targetAllocation: () => 1 };
    const r = runBacktest(opts(enterOnce, { mode: 'lump', initialCapital: 10000, contribution: 0 }));

    const entryBar = DATA[DEFAULT_OPTIONS.warmup + 1]!;
    const expectedPrice = entryBar.open * (1 + DEFAULT_OPTIONS.slippagePct / 100);
    const fee = 10000 * (DEFAULT_OPTIONS.feePct / 100);
    const expectedBtc = (10000 - fee) / expectedPrice;
    const expectedValue = expectedBtc * entryBar.close;

    assert.ok(
      Math.abs(r.equity[0]!.value - expectedValue) / expectedValue < 0.002,
      `first mark-to-market ${r.equity[0]!.value} vs expected ${expectedValue}`
    );
  });

  test('costs reduce the final value', () => {
    const free = runBacktest(opts(sma200Filter, { feePct: 0, slippagePct: 0 }));
    const costly = runBacktest(opts(sma200Filter, { feePct: 0.5, slippagePct: 0.2 }));
    assert.ok(costly.metrics.finalValue < free.metrics.finalValue);
    assert.ok(costly.metrics.feesPaid > 0);
    assert.equal(free.metrics.feesPaid, 0);
  });

  test('a wider rebalance band means fewer trades', () => {
    // The band travels with the strategy config, because that is what the
    // sweep varies. Passing it through engine options would be ignored.
    const withBand = (b: number) => signalEngineStrategy({ ...DEFAULT_CONFIG, rebalanceBand: b });
    const tight = runBacktest(opts(withBand(0.02)));
    const wide = runBacktest(opts(withBand(0.45)));
    assert.ok(
      tight.metrics.rebalances > wide.metrics.rebalances,
      `tight ${tight.metrics.rebalances} vs wide ${wide.metrics.rebalances}`
    );
  });

  test("a strategy's own band takes precedence over the engine default", () => {
    const pinned: Strategy = {
      name: 'pinned', description: '', rebalanceBand: 0.9,
      targetAllocation: ({ history }) => (history.length % 2 === 0 ? 0 : 1),
    };
    const loose = runBacktest(opts(pinned, { rebalanceBand: 0.001 }));
    const free = runBacktest(opts({ ...pinned, rebalanceBand: undefined }, { rebalanceBand: 0.001 }));
    assert.ok(free.metrics.rebalances > loose.metrics.rebalances);
  });

  test('every strategy receives identical contributions', () => {
    const a = runBacktest(opts(buyAndHold));
    const b = runBacktest(opts(sma200Filter));
    const c = runBacktest(opts(signalEngineStrategy()));
    assert.equal(a.metrics.contributed, b.metrics.contributed);
    assert.equal(b.metrics.contributed, c.metrics.contributed);
    assert.ok(a.metrics.contributed > 0);
  });

  test('buy and hold stays essentially fully invested', () => {
    const r = runBacktest(opts(buyAndHold));
    assert.ok(r.metrics.avgAllocationPct > 88, `avg allocation ${r.metrics.avgAllocationPct}%`);
  });

  test('allocation never leaves 0..1 and cash never goes negative', () => {
    const r = runBacktest(opts(signalEngineStrategy()));
    for (const p of r.equity) {
      assert.ok(p.allocation >= -1e-9 && p.allocation <= 1 + 1e-9, `allocation ${p.allocation}`);
      assert.ok(p.value >= 0, `value ${p.value}`);
    }
  });

  test('refuses to run on too little history rather than returning nonsense', () => {
    assert.throws(() => runBacktest({ ...DEFAULT_OPTIONS, candles: DATA.slice(0, 50), strategy: buyAndHold }));
  });
});

describe('metrics', () => {
  test('max drawdown finds the worst peak-to-trough fall', () => {
    assert.ok(Math.abs(maxDrawdown([100, 120, 60, 90]) - -50) < 1e-9);
    assert.equal(maxDrawdown([100, 110, 120]), 0);
  });

  test('IRR recovers a known rate', () => {
    const t0 = Date.UTC(2020, 0, 1);
    const oneYear = t0 + 365.25 * 86400000;
    // Put in 100, take out 110 a year later => 10%.
    const r = irr([{ time: t0, amount: -100 }, { time: oneYear, amount: 110 }]);
    assert.ok(Math.abs(r - 10) < 0.05, `irr ${r}`);
  });

  test('IRR handles staged contributions', () => {
    const t0 = Date.UTC(2020, 0, 1);
    const yr = 365.25 * 86400000;
    // 100 now and 100 in a year, worth 220 after two years.
    const r = irr([
      { time: t0, amount: -100 },
      { time: t0 + yr, amount: -100 },
      { time: t0 + 2 * yr, amount: 220 },
    ]);
    assert.ok(r > 0 && r < 30, `irr ${r} outside a sane band`);
  });

  test('contributions are not mistaken for performance', () => {
    // A portfolio that never moves but receives money must show ~0% return.
    const points: EquityPoint[] = [];
    const cashflows: { time: number; amount: number }[] = [];
    let contributed = 100;
    cashflows.push({ time: 0, amount: -100 });
    for (let i = 0; i < 400; i++) {
      if (i > 0 && i % 30 === 0) {
        contributed += 100;
        cashflows.push({ time: i * 86400000, amount: -100 });
      }
      points.push({ time: i * 86400000, value: contributed, allocation: 1, contributed });
    }
    const m = computeMetrics(points, cashflows, 0, 0);
    assert.ok(Math.abs(m.irrPct) < 1, `flat portfolio reported ${m.irrPct}% IRR`);
    assert.ok(Math.abs(m.annualVolPct) < 1e-6, 'a flat portfolio has no volatility');
    assert.equal(m.maxDrawdownPct, 0);
  });

  test('longest drawdown counts days spent under water', () => {
    const day = 86400000;
    const points: EquityPoint[] = [
      { time: 0, value: 100, allocation: 1, contributed: 100 },
      { time: day, value: 80, allocation: 1, contributed: 100 },
      { time: 5 * day, value: 90, allocation: 1, contributed: 100 },
      { time: 10 * day, value: 150, allocation: 1, contributed: 100 },
    ];
    const m = computeMetrics(points, [{ time: 0, amount: -100 }], 0, 0);
    assert.equal(m.longestDrawdownDays, 10);
  });
});

describe('data handling', () => {
  test('CSV survives a round trip', () => {
    const original = generateSyntheticSeries(30, 999);
    const back = parseCsv(toCsv(original));
    assert.equal(back.length, original.length);
    assert.equal(back[0]!.time, original[0]!.time);
    assert.ok(Math.abs(back[5]!.close - original[5]!.close) < 1e-6);
  });

  test('CSV accepts ISO dates and skips a header row', () => {
    const csv = 'time,open,high,low,close,volume\n2021-01-01,100,110,90,105,5\n2021-01-02,105,115,95,110,6';
    const rows = parseCsv(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.close, 105);
    assert.equal(rows[0]!.time, Date.parse('2021-01-01'));
  });

  test('CSV drops malformed and non-positive rows', () => {
    const csv = ['1609459200,100,110,90,105,5', 'garbage,1,2,3,4,5', '1609545600,0,0,0,0,0', '1609632000,1,2,3'].join('\n');
    assert.equal(parseCsv(csv).length, 1);
  });

  test('the synthetic series is deterministic for a given seed', () => {
    const a = generateSyntheticSeries(200, 4242);
    const b = generateSyntheticSeries(200, 4242);
    const c = generateSyntheticSeries(200, 4243);
    assert.deepEqual(a.map((x) => x.close), b.map((x) => x.close));
    assert.notDeepEqual(a.map((x) => x.close), c.map((x) => x.close));
  });

  test('the synthetic series looks like a risk asset, not a smooth line', () => {
    const s = generateSyntheticSeries(2000, 777);
    const dd = maxDrawdown(s.map((c) => c.close));
    // Bitcoin has repeatedly fallen 70%+. A generator that never does would
    // flatter any trend-following rule tested against it.
    assert.ok(dd < -50, `synthetic max drawdown only ${dd.toFixed(1)}%`);
    assert.ok(s.every((c) => c.high >= c.low && c.close > 0));
    assert.ok(s.every((c) => c.high >= Math.max(c.open, c.close) - 1e-9));
    assert.ok(s.every((c) => c.low <= Math.min(c.open, c.close) + 1e-9));
  });
});
