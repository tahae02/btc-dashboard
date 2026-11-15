import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gaugeArc, gaugePoint, fearGreedColor, FEAR_GREED_ZONES } from '../src/services/gauge';

describe('Fear & Greed gauge', () => {
  /**
   * REGRESSION TEST for the broken gauge. The large-arc flag flipped to 1 above
   * 50, which made SVG draw the arc on a different circle, off the picture.
   */
  test('never asks SVG for the long way round', () => {
    for (const v of [1, 25, 49, 50, 51, 72, 99, 100]) {
      const d = gaugeArc(100, 100, 80, 0, v)!;
      const flags = d.split(' A ')[1]!.split(' ');
      assert.equal(flags[3], '0', `large-arc flag at ${v}`);
      assert.equal(flags[4], '1', `sweep flag at ${v}`);
    }
  });

  test('the arc runs from the far left to the needle', () => {
    const d = gaugeArc(100, 100, 80, 0, 72)!;
    assert.ok(d.startsWith('M 20 100 '), d);
    const tip = gaugePoint(100, 100, 80, 72);
    assert.ok(d.endsWith(`${Math.round(tip.x * 100) / 100} ${Math.round(tip.y * 100) / 100}`), d);
    assert.ok(tip.x > 100 && tip.y < 100, 'a greedy reading sits right of centre, above the pivot');
  });

  test('0 is far left, 50 straight up, 100 far right', () => {
    const a = gaugePoint(100, 100, 80, 0);
    const b = gaugePoint(100, 100, 80, 50);
    const c = gaugePoint(100, 100, 80, 100);
    assert.equal(Math.round(a.x), 20);
    assert.equal(Math.round(b.y), 20);
    assert.equal(Math.round(c.x), 180);
  });

  test('an empty span draws nothing', () => {
    assert.equal(gaugeArc(100, 100, 80, 0, 0), null);
  });

  test('the five zones cover 0 to 100 without gaps', () => {
    assert.equal(FEAR_GREED_ZONES[0].from, 0);
    assert.equal(FEAR_GREED_ZONES[FEAR_GREED_ZONES.length - 1].to, 100);
    for (let i = 1; i < FEAR_GREED_ZONES.length; i++) assert.equal(FEAR_GREED_ZONES[i]!.from, FEAR_GREED_ZONES[i - 1]!.to);
    assert.equal(fearGreedColor(10), FEAR_GREED_ZONES[0].color);
    assert.equal(fearGreedColor(90), FEAR_GREED_ZONES[4].color);
  });
});
