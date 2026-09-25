import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  lastClosedIndex, callOnDay, replayCalls, reconstructStamp, scoreCalls, parseSignalLog, appendToLog,
  REPLAY_WARMUP, type DayCall, type LoggedCall,
} from '../src/services/trackRecord';
import { generateSyntheticSeries } from '../backtest/data';
import type { OHLCVCandle } from '../src/types';

const DAY = 86400000;
const DATA = generateSyntheticSeries(420, 777);

describe('replay', () => {
  test('lastClosedIndex only counts bars that had fully closed', () => {
    const t = DATA[10]!.time;
    assert.equal(lastClosedIndex(DATA, t + DAY), 10, 'bar 10 closes exactly at t + 1 day');
    assert.equal(lastClosedIndex(DATA, t + DAY - 1), 9, 'one ms earlier it is still open');
    assert.equal(lastClosedIndex(DATA, DATA[0]!.time), -1);
  });

  test('no call during warm-up, so every replayed call has the full regime read', () => {
    assert.equal(callOnDay(DATA, REPLAY_WARMUP - 2), null);
    assert.ok(callOnDay(DATA, REPLAY_WARMUP - 1));
  });

  /**
   * REGRESSION GUARD, same idea as the backtester's: a replayed call must not
   * move when the future is rewritten. If it did, the track record would be
   * grading the engine with information it never had.
   */
  test('replayed calls ignore everything after their own bar', () => {
    const cut = 300;
    const tampered: OHLCVCandle[] = DATA.map((c, i) => (i <= cut ? c : { ...c, open: c.open * 9, high: c.high * 9, low: c.low * 9, close: c.close * 9 }));
    assert.deepEqual(replayCalls(tampered, 0, cut + 1), replayCalls(DATA, 0, cut + 1));
  });

  test('chunked replay equals one pass', () => {
    const whole = replayCalls(DATA, 0, DATA.length);
    const chunked = [...replayCalls(DATA, 0, 260), ...replayCalls(DATA, 260, 333), ...replayCalls(DATA, 333, DATA.length)];
    assert.deepEqual(chunked, whole);
    assert.equal(whole.length, DATA.length - (REPLAY_WARMUP - 1));
  });

  test('a back-dated trade gets the call from the last bar closed before it', () => {
    const i = 350;
    const stamp = reconstructStamp(DATA, DATA[i]!.time + DAY + 5 * 3600000);
    const call = callOnDay(DATA, i)!;
    assert.equal(stamp?.action, call.action);
    assert.equal(stamp?.dcaMultiplier, call.dcaMultiplier);
    assert.equal(stamp?.source, 'reconstructed');
    assert.equal(reconstructStamp(DATA, DATA[5]!.time), null, 'too early to have a signal');
  });
});

describe('scoreCalls', () => {
  // Hand-made: price rises 1 per day from 100, so every forward return is known.
  const T0 = Date.UTC(2025, 0, 1);
  const line: OHLCVCandle[] = Array.from({ length: 120 }, (_, i) => ({ time: T0 + i * DAY, open: 0, high: 0, low: 0, close: 100 + i }));
  const call = (i: number, over: Partial<DayCall> = {}): DayCall => ({
    day: T0 + i * DAY, action: 'HOLD', targetAllocation: 0.5, dcaMultiplier: 1, conviction: 50, regimeScore: 0, atr: 2, ...over,
  });

  test('forward returns are measured close to close from the call\'s own bar', () => {
    const r = scoreCalls([call(0)], line);
    assert.ok(Math.abs((r.baseline[7].mean ?? 0) - 0.07) < 1e-12);
    assert.ok(Math.abs((r.baseline[30].mean ?? 0) - 0.3) < 1e-12);
    assert.ok(Math.abs((r.baseline[90].mean ?? 0) - 0.9) < 1e-12);
  });

  test('horizons past the end of the data are left out, not counted as zero', () => {
    const r = scoreCalls([call(100)], line);
    assert.equal(r.baseline[7].n, 1);
    assert.equal(r.baseline[30].n, 0);
    assert.equal(r.baseline[30].mean, null);
  });

  test('groups by tier, in tier order, with an honest independent-period count', () => {
    const calls = [
      ...Array.from({ length: 45 }, (_, i) => call(i, { action: 'HOLD' })),
      ...Array.from({ length: 10 }, (_, i) => call(45 + i, { action: 'ACCUMULATE_STRONG' })),
    ];
    const r = scoreCalls(calls, line);
    assert.deepEqual(r.tiers.map((t) => t.action), ['ACCUMULATE_STRONG', 'HOLD']);
    assert.equal(r.tiers[1]!.days, 45);
    assert.equal(r.tiers[1]!.independentPeriods, 1, '45 overlapping days are one-and-a-bit 30-day periods');
    assert.equal(r.tiers[0]!.independentPeriods, 0);
  });

  test('range check: a 1-per-day move sits inside an ATR of 2, outside an ATR of 0.5', () => {
    assert.equal(scoreCalls([call(0, { atr: 2 })], line).range1d.rate, 1);
    assert.equal(scoreCalls([call(0, { atr: 0.5 })], line).range1d.rate, 0);
    // 7 days moves 7; the 7d band is atr x sqrt(7) = 5.29 for atr 2.
    assert.equal(scoreCalls([call(0, { atr: 2 })], line).range7d.rate, 0);
  });

  /**
   * On a steadily RISING market, buying more on later weeks means buying more
   * at higher prices, so a rising multiplier must show a WORSE average cost.
   * This proves the comparison is per unit of money, not just "more money
   * bought more BTC".
   */
  test('DCA comparison is per unit of money invested', () => {
    const rising = Array.from({ length: 100 }, (_, i) => call(i, { dcaMultiplier: i < 50 ? 0.5 : 2 }));
    const r = scoreCalls(rising, line);
    assert.ok(r.dca);
    assert.ok(r.dca.advantagePct < 0, `expected worse, got ${r.dca.advantagePct}`);
    const flat = scoreCalls(Array.from({ length: 100 }, (_, i) => call(i)), line);
    assert.ok(Math.abs(flat.dca!.advantagePct) < 1e-9, 'a 1x multiplier is exactly flat DCA');
    assert.equal(flat.dca!.investedRatio, 1);
  });

  test('replay over a realistic series produces a sane record', () => {
    const r = scoreCalls(replayCalls(DATA, 0, DATA.length), DATA);
    assert.equal(r.days, DATA.length - (REPLAY_WARMUP - 1));
    assert.ok(r.tiers.length >= 1);
    assert.ok(r.range1d.rate != null && r.range1d.rate > 0 && r.range1d.rate < 1);
  });
});

describe('signal log', () => {
  const entry = (day: number, over: Partial<LoggedCall> = {}): LoggedCall => ({
    day, action: 'ACCUMULATE', targetAllocation: 0.7, dcaMultiplier: 1.2, conviction: 60, regimeScore: 2, atr: 1000,
    loggedAt: day + 2 * DAY, fearGreed: 40, ...over,
  });

  test('keeps the first call seen for a day, and returns the same array when unchanged', () => {
    const log = appendToLog([], entry(1));
    const again = appendToLog(log, entry(1, { action: 'HOLD' }));
    assert.equal(again, log);
    assert.equal(again[0]!.action, 'ACCUMULATE');
  });

  test('stays sorted and capped', () => {
    let log: LoggedCall[] = [];
    for (const d of [5, 1, 3, 2, 4]) log = appendToLog(log, entry(d), 3);
    assert.deepEqual(log.map((e) => e.day), [3, 4, 5]);
  });

  test('round-trips through storage and drops junk', () => {
    const raw = JSON.stringify([entry(1), entry(2), { day: 'x' }, { ...entry(3), action: 'MOON' }, entry(1, { action: 'HOLD' })]);
    const log = parseSignalLog(raw);
    assert.deepEqual(log.map((e) => e.day), [1, 2]);
    assert.equal(log[0]!.action, 'ACCUMULATE');
    assert.deepEqual(parseSignalLog('nope'), []);
  });
});
