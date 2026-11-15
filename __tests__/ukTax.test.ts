import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { taxSummary, taxYearOf, allowanceFor } from '../src/services/ukTax';
import { portfolioHistory } from '../src/services/portfolioHistory';
import type { Trade, OpeningPosition } from '../src/services/journal';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
let n = 0;
const t = (side: 'buy' | 'sell', time: number, fiat: number, btc: number, over: Partial<Trade> = {}): Trade => ({
  id: `t${n++}`, side, time, fiat, btc, currency: 'GBP', unitPrice: null, fee: 0,
  marketPriceUsd: null, marketPriceGbp: null, signal: null, note: '', createdAt: time, ...over,
});
const LIVE = { usd: 100000, gbp: 80000 };

describe('UK tax year', () => {
  test('runs from 6 April to 5 April', () => {
    assert.equal(taxYearOf(at(2026, 4, 5)), 2025);
    assert.equal(taxYearOf(at(2026, 4, 6)), 2026);
    assert.equal(taxYearOf(at(2026, 1, 10)), 2025);
  });

  test('knows the tax-free allowance, and says when it is assumed', () => {
    assert.deepEqual(allowanceFor(2024), { amount: 3000, known: true });
    assert.deepEqual(allowanceFor(2023), { amount: 6000, known: true });
    assert.equal(allowanceFor(2030).known, false);
  });
});

describe('matching sales to purchases', () => {
  test('the pool: a sale costs the average of everything held', () => {
    const s = taxSummary([
      t('buy', at(2025, 5, 1), 10000, 1),
      t('buy', at(2025, 7, 1), 20000, 1),
      t('sell', at(2025, 9, 1), 18000, 1),
    ], null, LIVE);
    assert.equal(s.years.length, 1);
    assert.equal(s.years[0]!.costs, 15000);
    assert.equal(s.years[0]!.net, 3000);
    assert.equal(s.years[0]!.overAllowance, 0);
  });

  test('same day: a buy on the day of a sale is matched first', () => {
    const s = taxSummary([
      t('buy', at(2025, 5, 1), 10000, 1),
      t('sell', at(2025, 9, 1), 9000, 0.5),
      t('buy', at(2025, 9, 1), 8000, 0.5),
    ], null, LIVE);
    assert.equal(s.years[0]!.costs, 8000);
    assert.equal(s.years[0]!.net, 1000);
  });

  test('the next 30 days: buying back within a month is matched before the pool', () => {
    const s = taxSummary([
      t('buy', at(2025, 5, 1), 10000, 1),
      t('sell', at(2025, 9, 1), 12000, 1),
      t('buy', at(2025, 9, 11), 11000, 1),
    ], null, LIVE);
    assert.equal(s.years[0]!.costs, 11000, 'matched to the buy ten days later, not the pool at 10,000');
    assert.equal(s.years[0]!.net, 1000);
  });

  test('a buy 31 days later goes to the pool instead', () => {
    const s = taxSummary([
      t('buy', at(2025, 5, 1), 10000, 1),
      t('sell', at(2025, 9, 1), 12000, 1),
      t('buy', at(2025, 10, 2), 11000, 1),
    ], null, LIVE);
    assert.equal(s.years[0]!.costs, 10000);
  });

  test('losses are set against gains in the same year', () => {
    const s = taxSummary([
      t('buy', at(2025, 5, 1), 10000, 2),
      t('sell', at(2025, 6, 1), 7000, 1),
      t('sell', at(2025, 8, 1), 4000, 1),
    ], null, LIVE);
    assert.equal(s.years[0]!.gains, 2000);
    assert.equal(s.years[0]!.losses, 1000);
    assert.equal(s.years[0]!.net, 1000);
  });

  test('sales in different tax years are reported separately, newest first', () => {
    const s = taxSummary([
      t('buy', at(2025, 1, 1), 10000, 2),
      t('sell', at(2025, 4, 5), 9000, 1),
      t('sell', at(2025, 4, 6), 12000, 1),
    ], null, LIVE);
    assert.deepEqual(s.years.map((y) => [y.startYear, y.net]), [[2025, 7000], [2024, 4000]]);
    assert.equal(s.years[0]!.overAllowance, 4000);
  });

  test('a dollar sale is converted at the rate on its day', () => {
    const s = taxSummary([
      t('buy', at(2025, 5, 1), 8000, 0.1),
      t('sell', at(2025, 9, 1), 12500, 0.1, { currency: 'USD', marketPriceUsd: 125000, marketPriceGbp: 100000 }),
    ], null, LIVE);
    assert.equal(s.years[0]!.proceeds, 10000);
    assert.equal(s.atTodaysRate, false);
  });

  test('the starting balance is the opening pool', () => {
    const opening: OpeningPosition = { time: at(2025, 4, 1), invested: 30000, currency: 'GBP', btc: 1, updatedAt: at(2025, 4, 1) };
    const s = taxSummary([t('sell', at(2025, 9, 1), 20000, 0.5)], opening, LIVE);
    assert.equal(s.years[0]!.costs, 15000);
    assert.equal(s.usesOpening, true);
  });

  test('selling more than was logged is flagged, not hidden', () => {
    const s = taxSummary([t('buy', at(2025, 5, 1), 1000, 0.1), t('sell', at(2025, 9, 1), 3000, 0.3)], null, LIVE);
    assert.equal(s.unmatched, true);
  });

  test('no sales, no years', () => {
    assert.equal(taxSummary([t('buy', at(2025, 5, 1), 1000, 0.1)], null, LIVE).years.length, 0);
  });
});

describe('portfolioHistory', () => {
  const DAY = 86400000;
  const bars = (start: number, closes: number[]) => closes.map((c, i) => ({ time: start + i * DAY, open: c, high: c, low: c, close: c }));

  test('value against what you paid, day by day, from the first trade', () => {
    const start = Date.UTC(2025, 0, 1);
    const daily = bars(start, [50000, 60000, 70000, 80000]);
    const h = portfolioHistory([t('buy', start + DAY + 3600000, 600, 0.01)], null, daily, 'GBP', LIVE);
    assert.equal(h.length, 3, 'starts on the day of the first trade');
    assert.deepEqual(h.map((p) => Math.round(p.value)), [600, 700, 800]);
    assert.ok(h.every((p) => p.paidIn === 600));
  });

  test('starts at the starting balance and matches its holdings', () => {
    const start = Date.UTC(2025, 0, 1);
    const daily = bars(start, [50000, 60000, 70000]);
    const opening: OpeningPosition = { time: start + 2 * DAY + 3600000, invested: 1000, currency: 'GBP', btc: 0.02, updatedAt: start };
    const h = portfolioHistory([], opening, daily, 'GBP', LIVE);
    assert.equal(h.length, 1);
    assert.equal(h[0]!.value, 1400);
    assert.equal(h[0]!.paidIn, 1000);
  });

  test('nothing held, nothing drawn', () => {
    assert.deepEqual(portfolioHistory([], null, bars(0, [1, 2]), 'GBP', LIVE), []);
  });
});
