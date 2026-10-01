import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCALE_MIN, SCALE_MAX, PRESET_PRICES, SCALE_TICKS, snapPrice, positionForPrice, priceAtPosition, nudgePrice,
  shortPrice, parsePriceInput, defaultTarget, convertTarget, project, btcForAmount, parseCalculatorState,
  DEFAULT_CALCULATOR,
} from '../src/services/calculator';

const LIVE = { usd: 80_000, gbp: 60_000 };
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

describe('slider scale', () => {
  test('is logarithmic: $100k sits in the middle', () => {
    close(positionForPrice(SCALE_MIN), 0);
    close(positionForPrice(100_000), 0.5);
    close(positionForPrice(SCALE_MAX), 1);
  });

  test('pins prices off the scale to an end', () => {
    assert.equal(positionForPrice(1_000), 0);
    assert.equal(positionForPrice(5_000_000), 1);
    assert.equal(positionForPrice(0), 0);
  });

  test('every preset and tick survives a round trip through the track', () => {
    for (const p of [...PRESET_PRICES, ...SCALE_TICKS]) assert.equal(priceAtPosition(positionForPrice(p)), p);
  });

  test('snaps to round numbers, finer at lower prices', () => {
    assert.equal(snapPrice(43_620), 44_000);
    assert.equal(snapPrice(123_400), 125_000);
    assert.equal(snapPrice(612_000), 610_000);
    assert.equal(snapPrice(2), SCALE_MIN);
    assert.equal(snapPrice(9e9), SCALE_MAX);
  });

  test('nudges land on the next round number either way', () => {
    assert.equal(nudgePrice(100_000, 1), 105_000);
    assert.equal(nudgePrice(100_000, -1), 99_000);
    assert.equal(nudgePrice(123_456, 1), 125_000);
    assert.equal(nudgePrice(123_456, -1), 120_000);
    assert.equal(nudgePrice(500_000, -1), 495_000);
    assert.equal(nudgePrice(SCALE_MAX, 1), SCALE_MAX);
    assert.equal(nudgePrice(SCALE_MIN, -1), SCALE_MIN);
  });

  test('short labels', () => {
    assert.equal(shortPrice(10_000, 'USD'), '$10k');
    assert.equal(shortPrice(250_000, 'GBP'), '£250k');
    assert.equal(shortPrice(1_000_000, 'USD'), '$1M');
    assert.equal(shortPrice(1_500_000, 'GBP'), '£1.5M');
  });
});

describe('parsePriceInput', () => {
  test('accepts plain, comma, symbol and k/m forms', () => {
    assert.equal(parsePriceInput('100000'), 100_000);
    assert.equal(parsePriceInput('100,000'), 100_000);
    assert.equal(parsePriceInput('£100k'), 100_000);
    assert.equal(parsePriceInput('$1.5M'), 1_500_000);
    assert.equal(parsePriceInput(' 250 k '), 250_000);
  });

  test('rejects nonsense, zero and absurd prices', () => {
    for (const s of ['', 'abc', '0', '-5', '1e5', '10b', '1,000,000,000']) assert.equal(parsePriceInput(s), null, s);
  });
});

describe('defaultTarget', () => {
  test('opens on the first round number comfortably above today', () => {
    assert.equal(defaultTarget(80_000), 100_000);
    assert.equal(defaultTarget(96_000), 150_000);
    assert.equal(defaultTarget(120_000), 150_000);
    assert.equal(defaultTarget(2_000_000), SCALE_MAX);
  });

  test('falls back to $100k without a price', () => {
    assert.equal(defaultTarget(null), 100_000);
    assert.equal(defaultTarget(0), 100_000);
  });
});

describe('convertTarget', () => {
  test('converts at the rate implied by the live prices, onto a round step', () => {
    assert.equal(convertTarget(100_000, 'USD', 'GBP', LIVE), 75_000);
    assert.equal(convertTarget(75_000, 'GBP', 'USD', LIVE), 100_000);
    assert.equal(convertTarget(100_000, 'USD', 'USD', LIVE), 100_000);
  });

  test('keeps an off-scale price exact rather than pinning it', () => {
    assert.equal(convertTarget(2_000_000, 'USD', 'GBP', LIVE), 1_500_000);
  });

  test('leaves the number alone without live prices', () => {
    assert.equal(convertTarget(100_000, 'USD', 'GBP', { usd: 0, gbp: 0 }), 100_000);
  });
});

describe('project', () => {
  test('values what you hold at the picked price, in both currencies', () => {
    // 0.135 BTC that cost £8,100; at $100k (£75k at today's rate).
    const p = project({ btc: 0.135, paid: 8_100, paidCurrency: 'GBP', target: 100_000, targetCurrency: 'USD', live: LIVE });
    close(p.worth.USD, 13_500, 1e-6);
    close(p.worth.GBP, 10_125, 1e-6);
    close(p.paid!.GBP, 8_100);
    close(p.paid!.USD, 10_800, 1e-6);
    close(p.gain!.GBP, 2_025, 1e-6);
    close(p.gain!.USD, 2_700, 1e-6);
    close(p.gainPct!, 0.25, 1e-9);
    close(p.moveFromToday!, 0.25);
    close(p.worthToday.USD, 10_800, 1e-6);
    close(p.worthToday.GBP, 8_100, 1e-6);
    assert.deepEqual(p.targetIn, { USD: 100_000, GBP: 75_000 });
  });

  test('the percentage is the same whichever currency the scale is in', () => {
    const usd = project({ btc: 0.1, paid: 5_000, paidCurrency: 'GBP', target: 120_000, targetCurrency: 'USD', live: LIVE });
    const gbp = project({ btc: 0.1, paid: 5_000, paidCurrency: 'GBP', target: 90_000, targetCurrency: 'GBP', live: LIVE });
    close(usd.gainPct!, gbp.gainPct!);
    close(usd.worth.GBP, gbp.worth.GBP, 1e-6);
  });

  test('shows a loss as a negative gain', () => {
    const p = project({ btc: 0.1, paid: 8_000, paidCurrency: 'GBP', target: 40_000, targetCurrency: 'GBP', live: LIVE });
    close(p.gain!.GBP, -4_000, 1e-6);
    close(p.gainPct!, -0.5);
    close(p.moveFromToday!, 40_000 / 60_000 - 1);
  });

  test('leaves the gain out when the cost is unknown', () => {
    const p = project({ btc: 0.1, paid: null, paidCurrency: 'GBP', target: 100_000, targetCurrency: 'USD', live: LIVE });
    assert.equal(p.paid, null);
    assert.equal(p.gain, null);
    assert.equal(p.gainPct, null);
  });

  test('no move from today without a live price', () => {
    const p = project({ btc: 0.1, paid: 1, paidCurrency: 'GBP', target: 100_000, targetCurrency: 'USD', live: { usd: 0, gbp: 0 } });
    assert.equal(p.moveFromToday, null);
  });
});

describe('btcForAmount', () => {
  test('buys at today\'s price in the amount\'s currency', () => {
    close(btcForAmount(8_100, 'GBP', LIVE), 0.135);
    close(btcForAmount(8_000, 'USD', LIVE), 0.1);
  });

  test('is zero without a price or an amount', () => {
    assert.equal(btcForAmount(8_100, 'GBP', { usd: 0, gbp: 0 }), 0);
    assert.equal(btcForAmount(0, 'GBP', LIVE), 0);
  });

  test('an amount bought today gains exactly the price move', () => {
    const btc = btcForAmount(8_100, 'GBP', LIVE);
    const p = project({ btc, paid: 8_100, paidCurrency: 'GBP', target: 100_000, targetCurrency: 'USD', live: LIVE });
    close(p.gainPct!, p.moveFromToday!);
  });
});

describe('parseCalculatorState', () => {
  test('defaults to dollars on the scale and your holdings', () => {
    assert.deepEqual(parseCalculatorState(null), DEFAULT_CALCULATOR);
    assert.equal(DEFAULT_CALCULATOR.currency, 'USD');
    assert.deepEqual(parseCalculatorState('not json'), DEFAULT_CALCULATOR);
    assert.deepEqual(parseCalculatorState('[1,2]'), DEFAULT_CALCULATOR);
  });

  test('round-trips a saved state', () => {
    const s = { target: 150_000, currency: 'GBP' as const, basis: 'amount' as const, amount: 8_100, amountCurrency: 'USD' as const };
    assert.deepEqual(parseCalculatorState(JSON.stringify(s)), s);
  });

  test('keeps the good fields of a damaged payload', () => {
    const s = parseCalculatorState(JSON.stringify({ target: -1, currency: 'EUR', basis: 'amount', amount: 'lots' }));
    assert.deepEqual(s, { ...DEFAULT_CALCULATOR, basis: 'amount' });
  });
});
