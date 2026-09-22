import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseSettings, DEFAULT_SETTINGS, MIN_RSI_GAP } from '../src/services/settings';
import { estimateCirculatingSupply } from '../src/services/supply';

describe('sanitiseSettings', () => {
  test('passes a valid payload through untouched', () => {
    const input = { ...DEFAULT_SETTINGS, rsiOversold: 25, rsiOverbought: 75 };
    assert.deepEqual(sanitiseSettings(input), input);
  });

  /**
   * REGRESSION TEST. The old settings screen validated each RSI threshold on
   * its own, so oversold could be set above overbought. Nothing flagged it,
   * and every RSI-derived reading silently inverted.
   */
  test('rejects inverted RSI thresholds instead of accepting them', () => {
    const out = sanitiseSettings({ rsiOversold: 90, rsiOverbought: 10 });
    assert.ok(out.rsiOversold < out.rsiOverbought, 'oversold must end up below overbought');
    assert.equal(out.rsiOversold, DEFAULT_SETTINGS.rsiOversold);
    assert.equal(out.rsiOverbought, DEFAULT_SETTINGS.rsiOverbought);
  });

  test('rejects thresholds that are too close together to mean anything', () => {
    const out = sanitiseSettings({ rsiOversold: 49, rsiOverbought: 50 });
    assert.ok(out.rsiOverbought - out.rsiOversold >= MIN_RSI_GAP);
  });

  test('always yields oversold below overbought, for any pair of inputs', () => {
    for (let os = 0; os <= 100; os += 7) {
      for (let ob = 0; ob <= 100; ob += 7) {
        const out = sanitiseSettings({ rsiOversold: os, rsiOverbought: ob });
        assert.ok(
          out.rsiOversold < out.rsiOverbought,
          `invariant broken for oversold=${os} overbought=${ob} -> ${out.rsiOversold}/${out.rsiOverbought}`
        );
      }
    }
  });

  test('clamps stretch weight so mean reversion cannot overpower the regime', () => {
    assert.equal(sanitiseSettings({ stretchWeight: 5 }).stretchWeight, 0.5);
    assert.equal(sanitiseSettings({ stretchWeight: -1 }).stretchWeight, 0);
  });

  test('falls back to defaults for unknown enum values', () => {
    const out = sanitiseSettings({
      refreshInterval: 'hourly' as never,
      currency: 'EUR' as never,
      signalTimeframe: '3M' as never,
    });
    assert.equal(out.refreshInterval, DEFAULT_SETTINGS.refreshInterval);
    assert.equal(out.currency, DEFAULT_SETTINGS.currency);
    assert.equal(out.signalTimeframe, DEFAULT_SETTINGS.signalTimeframe);
  });

  test('survives junk from storage without throwing', () => {
    for (const junk of [null, undefined, {}, { rsiOversold: NaN }, { stretchWeight: 'abc' } as never]) {
      const out = sanitiseSettings(junk as never);
      assert.ok(out.rsiOversold < out.rsiOverbought);
      assert.ok(Number.isFinite(out.stretchWeight));
    }
  });
});

describe('estimateCirculatingSupply', () => {
  test('matches the fourth-halving checkpoint exactly', () => {
    assert.equal(estimateCirculatingSupply(Date.UTC(2024, 3, 20)), 19_687_500);
  });

  test('tracks the known figure shortly after the checkpoint', () => {
    // BTC supply was around 19.80m at the start of 2025.
    const s = estimateCirculatingSupply(Date.UTC(2025, 0, 1));
    assert.ok(Math.abs(s / 19_805_000 - 1) < 0.005, `got ${s}`);
  });

  test('increases monotonically and never exceeds the 21m cap', () => {
    let prev = 0;
    for (let year = 2024; year <= 2140; year += 4) {
      const s = estimateCirculatingSupply(Date.UTC(year, 0, 1));
      assert.ok(s >= prev, `supply fell between ${year - 4} and ${year}`);
      assert.ok(s <= 21_000_000, `supply exceeded the cap in ${year}: ${s}`);
      prev = s;
    }
  });

  test('does not run backwards before the checkpoint', () => {
    assert.equal(estimateCirculatingSupply(Date.UTC(2020, 0, 1)), 19_687_500);
  });
});
