import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GLOSSARY, GLOSSARY_SECTIONS, type GlossaryKey, type GlossaryEntry } from '../src/services/glossary';
import { describeMarket, ACTION_PLAIN } from '../src/services/plainEnglish';
import { computeSignal } from '../src/services/signalEngine';
import { computeIndicators } from '../src/services/indicators';
import { generateSyntheticSeries } from '../backtest/data';
import type { SignalResult, Action } from '../src/types';

describe('glossary', () => {
  test('every entry says what it is and how to read it', () => {
    for (const [key, e] of (Object.entries(GLOSSARY) as [string, GlossaryEntry][])) {
      assert.ok(e.title.length > 2, `${key} has no title`);
      assert.ok(e.what.length > 30, `${key}: "what" is too thin`);
      assert.ok(e.read.length > 30, `${key}: "read" is too thin`);
    }
  });

  test('the guide lists every entry exactly once', () => {
    const listed = GLOSSARY_SECTIONS.flatMap((s) => s.keys);
    assert.equal(new Set(listed).size, listed.length, 'an entry is listed twice');
    assert.deepEqual([...listed].sort(), (Object.keys(GLOSSARY) as GlossaryKey[]).sort(), 'an entry is missing from the guide');
  });

  /** The user asked for plain English; these phrases are exactly what they asked to avoid. */
  test('entries do not lean on undefined trader jargon', () => {
    for (const [key, e] of (Object.entries(GLOSSARY) as [string, GlossaryEntry][])) {
      const text = `${e.what} ${e.read} ${e.app ?? ''}`.toLowerCase();
      for (const jargon of ['bearish divergence', 'confluence', 'price action', 'mean reversion', 'long the', 'short the']) {
        assert.ok(!text.includes(jargon), `${key} uses "${jargon}"`);
      }
    }
  });
});

const base: SignalResult = {
  regime: 'BULL', regimeScore: 3, regimeComponents: [], action: 'ACCUMULATE_STRONG', actionLabel: 'ACCUMULATE HARD',
  targetAllocation: 0.94, dcaMultiplier: 1.6, conviction: 74, stretchScore: 0.1, momentumScore: 0.4, readings: [], projections: null,
};

describe('describeMarket', () => {
  test('turns the multiplier into a concrete example in the right currency', () => {
    const text = describeMarket(base, 40, 'Fear', 'GBP').join(' ');
    assert.match(text, /1\.6× your normal amount/);
    assert.match(text, /£160 if you usually put in £100/);
    assert.match(text, /uptrend/);
    assert.match(text, /fear \(40 out of 100\)/);
    assert.match(text, /not a prediction/);
  });

  test('says when the mood is extreme, and leaves it out when unknown', () => {
    assert.match(describeMarket(base, 12, 'Extreme Fear', 'GBP').join(' '), /extreme fear/);
    assert.ok(!describeMarket(base, null, null, 'USD').join(' ').includes('mood'));
  });

  test('covers buying less and pausing, and weak conviction', () => {
    const cautious = { ...base, regime: 'BEAR' as const, regimeScore: -3, dcaMultiplier: 0.4, conviction: 30 };
    const text = describeMarket(cautious, null, null, 'USD').join(' ');
    assert.match(text, /downtrend/);
    assert.match(text, /less than usual/);
    assert.match(text, /\$40 instead of \$100/);
    assert.match(text, /weak call/);
    assert.match(describeMarket({ ...base, dcaMultiplier: 0 }, null, null, 'GBP').join(' '), /pausing/);
  });

  test('works on real engine output for every regime a long series produces', () => {
    const data = generateSyntheticSeries(1200, 99);
    const seen = new Set<string>();
    for (let i = 250; i < data.length; i += 25) {
      const window = data.slice(Math.max(0, i - 400), i);
      const s = computeSignal({ indicators: computeIndicators(window), currentPrice: window[window.length - 1]!.close });
      const text = describeMarket(s, 50, 'Neutral', 'GBP');
      assert.ok(text.length >= 4);
      for (const line of text) assert.ok(line.length > 10 && !line.includes('undefined') && !line.includes('NaN'), line);
      seen.add(s.regime);
    }
    assert.ok(seen.size >= 2, 'the series should exercise more than one regime');
  });

  test('every advice tier has a one-line meaning', () => {
    for (const a of ['ACCUMULATE_STRONG', 'ACCUMULATE', 'HOLD', 'REDUCE', 'EXIT'] as Action[]) assert.ok(ACTION_PLAIN[a].length > 10);
  });
});
