import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeIndicators } from '../src/services/indicators';
import { computeSignal, detectRegime, computeStretch, DEFAULT_CONFIG } from '../src/services/signalEngine';
import type { OHLCVCandle, Action } from '../src/types';

/** Build a candle series from a close-price generator. */
const series = (n: number, f: (i: number) => number): OHLCVCandle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { time: i * 86400000, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 };
  });

const signalFor = (candles: OHLCVCandle[], fearGreed: number | null = null) => {
  const indicators = computeIndicators(candles);
  return computeSignal({
    indicators,
    currentPrice: candles[candles.length - 1]!.close,
    fearGreed,
    config: DEFAULT_CONFIG,
  });
};

const steadyBull = series(400, (i) => 100 * Math.exp(i * 0.004));
const steadyBear = series(400, (i) => 100 * Math.exp(-i * 0.004));
const flat = series(400, () => 100);

describe('regime detection', () => {
  test('calls a sustained uptrend BULL', () => {
    assert.equal(detectRegime(computeIndicators(steadyBull)).regime, 'BULL');
  });

  test('calls a sustained downtrend BEAR', () => {
    assert.equal(detectRegime(computeIndicators(steadyBear)).regime, 'BEAR');
  });

  test('scores a flat market near zero', () => {
    const r = detectRegime(computeIndicators(flat));
    assert.ok(Math.abs(r.score) <= 1, `score ${r.score} should be near flat`);
  });

  test('reports one component per input it could evaluate', () => {
    const r = detectRegime(computeIndicators(steadyBull));
    assert.equal(r.components.length, 3);
    assert.ok(r.components.every((c) => typeof c.detail === 'string' && c.detail.length > 0));
  });
});

describe('the regime governs the call', () => {
  /**
   * The single most important behavioural fix. The old engine scored RSI >= 60
   * as BEARISH, so a healthy bull market where RSI sits at 60-70 for weeks was
   * reported as a reason to sell. Mean reversion must temper the allocation
   * inside a trend, never flip it.
   */
  test('a strong uptrend with a hot RSI still says accumulate', () => {
    const ind = computeIndicators(steadyBull);
    assert.ok(ind.rsi!.value > 60, `precondition: RSI is hot, got ${ind.rsi!.value}`);

    const sig = signalFor(steadyBull);
    assert.equal(sig.regime, 'BULL');
    assert.ok(
      sig.action === 'ACCUMULATE' || sig.action === 'ACCUMULATE_STRONG',
      `a hot RSI in an uptrend must not produce ${sig.action}`
    );
    assert.ok(sig.targetAllocation >= 0.65, `allocation ${sig.targetAllocation}`);
  });

  test('a downtrend keeps allocation low even when oversold', () => {
    const ind = computeIndicators(steadyBear);
    assert.ok(ind.rsi!.value < 40, `precondition: RSI is cold, got ${ind.rsi!.value}`);

    const sig = signalFor(steadyBear);
    assert.equal(sig.regime, 'BEAR');
    assert.ok(sig.targetAllocation <= 0.5, `allocation ${sig.targetAllocation} too high for a bear regime`);
  });

  test('stretch moves the allocation but cannot invert the regime', () => {
    const ind = computeIndicators(steadyBull);
    const hot = computeSignal({ indicators: ind, currentPrice: 1e9, config: DEFAULT_CONFIG });
    const cold = computeSignal({ indicators: ind, currentPrice: 1, config: DEFAULT_CONFIG });
    // An absurdly extended price lowers exposure, an absurdly depressed one
    // raises it, but both stay on the bullish side of the ledger.
    assert.ok(cold.targetAllocation > hot.targetAllocation);
    assert.ok(hot.targetAllocation >= DEFAULT_CONFIG.baseAllocationBull - DEFAULT_CONFIG.stretchWeight - DEFAULT_CONFIG.momentumWeight - 0.001);
  });
});

describe('every tier is reachable', () => {
  /**
   * The old engine could never emit STRONG BUY or STRONG SELL: three of its
   * nine votes were structurally dead, so the normalised score could not
   * reach the 0.6 threshold. Over 2,000 simulated series neither tier fired
   * once. Any scoring scheme must be checked against this.
   */
  test('the action set spans accumulate through stand-aside', () => {
    const seen = new Set<Action>();
    const configs = [
      steadyBull, steadyBear, flat,
      series(400, (i) => 100 * Math.exp(i * 0.008)),
      series(400, (i) => 100 * Math.exp(-i * 0.008)),
      series(400, (i) => 100 * Math.exp(i * 0.001) * (1 + 0.3 * Math.sin(i / 9))),
      series(400, (i) => 100 * Math.exp(-i * 0.002) * (1 + 0.3 * Math.sin(i / 7))),
    ];
    for (const c of configs) {
      for (const fg of [null, 10, 50, 90]) seen.add(signalFor(c, fg).action);
      // Also sweep the live price, which is what drives the stretch layer.
      const ind = computeIndicators(c);
      const base = c[c.length - 1]!.close;
      for (const mult of [0.3, 0.6, 1, 1.5, 3]) {
        seen.add(computeSignal({ indicators: ind, currentPrice: base * mult, config: DEFAULT_CONFIG }).action);
      }
    }
    assert.ok(seen.has('ACCUMULATE_STRONG'), 'ACCUMULATE_STRONG unreachable');
    assert.ok(seen.has('EXIT') || seen.has('REDUCE'), 'the defensive end is unreachable');
    assert.ok(seen.size >= 3, `only saw ${[...seen].join(', ')}`);
  });

  test('allocation always lands inside 0..1', () => {
    for (const c of [steadyBull, steadyBear, flat]) {
      const ind = computeIndicators(c);
      for (const price of [0.01, 1, 100, 1e6, 1e12]) {
        const a = computeSignal({ indicators: ind, currentPrice: price, config: DEFAULT_CONFIG }).targetAllocation;
        assert.ok(a >= 0 && a <= 1, `allocation ${a} out of range at price ${price}`);
      }
    }
  });
});

describe('conviction is real information', () => {
  /**
   * The old "confidence" was |score| / count, which is arithmetically the same
   * quantity that selected the badge sitting next to it. Its value was fully
   * determined by the badge, so it told the user nothing. Conviction here
   * measures agreement between independent families, so it must vary within a
   * single action.
   */
  test('two states with the same action can differ in conviction', () => {
    const byAction = new Map<Action, Set<number>>();
    const samples = [steadyBull, steadyBear, flat,
      series(400, (i) => 100 * Math.exp(i * 0.006)),
      series(400, (i) => 100 * (1 + 0.25 * Math.sin(i / 11))),
      series(400, (i) => 100 * Math.exp(i * 0.002) * (1 + 0.2 * Math.sin(i / 5)))];

    for (const c of samples) {
      const ind = computeIndicators(c);
      for (const mult of [0.5, 0.8, 1, 1.2, 2]) {
        const s = computeSignal({ indicators: ind, currentPrice: c[c.length - 1]!.close * mult, config: DEFAULT_CONFIG });
        if (!byAction.has(s.action)) byAction.set(s.action, new Set());
        byAction.get(s.action)!.add(s.conviction);
      }
    }
    const varying = [...byAction.values()].some((set) => set.size > 1);
    assert.ok(varying, 'conviction never varies within an action, so it adds nothing');
  });

  test('conviction stays within 0..100', () => {
    for (const c of [steadyBull, steadyBear, flat]) {
      const v = signalFor(c).conviction;
      assert.ok(v >= 0 && v <= 100, `conviction ${v}`);
    }
  });

  test('a clean trend converts more strongly than a directionless market', () => {
    assert.ok(signalFor(steadyBull).conviction > signalFor(flat).conviction);
  });
});

describe('sentiment', () => {
  test('acts contrarily, and only at extremes', () => {
    const ind = computeIndicators(flat);
    const price = flat[flat.length - 1]!.close;
    const neutral = computeSignal({ indicators: ind, currentPrice: price, fearGreed: 50, config: DEFAULT_CONFIG });
    const fear = computeSignal({ indicators: ind, currentPrice: price, fearGreed: 10, config: DEFAULT_CONFIG });
    const greed = computeSignal({ indicators: ind, currentPrice: price, fearGreed: 95, config: DEFAULT_CONFIG });
    const none = computeSignal({ indicators: ind, currentPrice: price, fearGreed: null, config: DEFAULT_CONFIG });

    assert.equal(neutral.targetAllocation, none.targetAllocation, 'mid-range sentiment must be inert');
    assert.ok(fear.targetAllocation > neutral.targetAllocation, 'extreme fear should raise exposure');
    assert.ok(greed.targetAllocation < neutral.targetAllocation, 'extreme greed should lower exposure');
  });
});

describe('configuration', () => {
  test('setting stretchWeight to zero removes mean reversion entirely', () => {
    const ind = computeIndicators(steadyBull);
    const cfg = { ...DEFAULT_CONFIG, stretchWeight: 0 };
    const hot = computeSignal({ indicators: ind, currentPrice: 1e9, config: cfg });
    const cold = computeSignal({ indicators: ind, currentPrice: 1, config: cfg });
    assert.equal(hot.targetAllocation, cold.targetAllocation);
  });

  test('stretch collapses its correlated inputs into a single score', () => {
    // RSI, StochRSI and Bollinger %B measure the same thing, so they are
    // averaged into one reading rather than cast as three separate votes.
    const s = computeStretch(computeIndicators(steadyBull), steadyBull[steadyBull.length - 1]!.close);
    assert.ok(s.parts.length >= 2, 'expected several inputs folded together');
    assert.ok(s.score >= -1 && s.score <= 1);
  });
});

describe('projections', () => {
  test('scale with the square root of time, not linearly', () => {
    const sig = signalFor(steadyBull);
    const p = sig.projections!;
    const width1d = p.range1d.high - p.range1d.low;
    const width7d = p.range7d.high - p.range7d.low;
    const ratio = width7d / width1d;
    assert.ok(Math.abs(ratio - Math.sqrt(7)) < 0.01, `7d/1d width ratio ${ratio}, expected ~${Math.sqrt(7)}`);
  });

  test('are labelled as a volatility range rather than a forecast', () => {
    assert.match(signalFor(steadyBull).projections!.note, /not a forecast/i);
  });
});

describe('readings', () => {
  test('every reading states how much it can move the allocation', () => {
    for (const r of signalFor(steadyBull, 50).readings) {
      assert.ok(r.weight.length > 0, `${r.name} has no stated weight`);
      assert.ok(r.explanation.length > 20, `${r.name} has no real explanation`);
    }
  });

  test('volatility is presented as context, never as a direction', () => {
    const atr = signalFor(steadyBull).readings.find((r) => r.name.includes('ATR'));
    assert.ok(atr, 'expected an ATR reading');
    // The old engine gave ATR a vote it could never cast, which silently
    // diluted every signal by one ninth.
    assert.equal(atr!.signal, 'NEUTRAL');
    assert.equal(atr!.family, 'CONTEXT');
  });
});
