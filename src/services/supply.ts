/**
 * Bitcoin circulating supply, used to derive market cap as price * supply.
 *
 * Kraken has no market-cap field, so the figure is computed locally. It is
 * extrapolated from a known checkpoint rather than hardcoded or simulated from
 * genesis:
 *
 *   - A hardcoded constant (the previous approach, 19,930,000) is correct on
 *     the day it is written and drifts further from reality every day after.
 *   - Simulating from the genesis block compounds the irregular block times of
 *     Bitcoin's early years and lands roughly 2% low.
 *   - Anchoring on a published halving and projecting forward at the
 *     protocol's target rate tracks reality to well under 0.5%, because
 *     difficulty retargeting holds the average block interval very close to
 *     ten minutes.
 *
 * Checkpoint: block 840,000, mined 2024-04-20, the fourth halving. At that
 * point 19,687,500 BTC had been issued and the block reward became 3.125 BTC.
 */
const HALVING_4_MS = Date.UTC(2024, 3, 20);
const SUPPLY_AT_HALVING_4 = 19_687_500;
const REWARD_AFTER_HALVING_4 = 3.125;
const BLOCKS_PER_DAY = 144; // 10-minute target
const HALVING_INTERVAL_BLOCKS = 210_000;

export const estimateCirculatingSupply = (now: number = Date.now()): number => {
  const days = (now - HALVING_4_MS) / 86400000;
  if (days <= 0) return SUPPLY_AT_HALVING_4;

  let blocksRemaining = days * BLOCKS_PER_DAY;
  let supply = SUPPLY_AT_HALVING_4;
  let reward = REWARD_AFTER_HALVING_4;

  // Walk forward through future halvings so this stays correct past 2028
  // without anyone needing to remember to update it.
  while (blocksRemaining > 0 && reward > 1e-8) {
    const mined = Math.min(blocksRemaining, HALVING_INTERVAL_BLOCKS);
    supply += mined * reward;
    blocksRemaining -= mined;
    reward /= 2;
  }
  // The 21m cap is asymptotic, but clamp anyway so a bad clock can never
  // produce a nonsensical market cap.
  return Math.min(supply, 21_000_000);
};
