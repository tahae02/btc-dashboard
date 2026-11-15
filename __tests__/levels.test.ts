import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levelDistance, usd0 } from '../src/services/levels';

describe('levelDistance', () => {
  test('a support under the price is a distance below', () => {
    assert.deepEqual(levelDistance(100000, 98000, 'support'), { text: '2.0% below', broken: false, fraction: 0.02 });
  });

  /**
   * REGRESSION TEST. With the live price under the nearest support, Signals
   * printed "$103,861, -0.9% below".
   */
  test('a support the price has already fallen through says so, with no minus sign', () => {
    const d = levelDistance(102960, 103861, 'support')!;
    assert.equal(d.broken, true);
    assert.equal(d.text, 'already broken: the price is 0.9% under it');
    assert.ok(!d.text.includes('-'));
  });

  test('resistance works the same way up', () => {
    assert.equal(levelDistance(100000, 103000, 'resistance')!.text, '3.0% above');
    assert.equal(levelDistance(104000, 103000, 'resistance')!.broken, true);
  });

  test('no level, no text', () => {
    assert.equal(levelDistance(0, 100, 'support'), null);
    assert.equal(levelDistance(100, 0, 'support'), null);
  });
});

describe('usd0', () => {
  test('readings show thousands separators', () => {
    assert.equal(usd0(103861), '$103,861');
    assert.equal(usd0(1958.4), '$1,958');
    assert.equal(usd0(950), '$950');
  });
});
