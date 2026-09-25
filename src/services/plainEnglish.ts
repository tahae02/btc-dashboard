/**
 * The current signal, said in everyday language.
 *
 * Pure, so the wording is tested against the same engine output the screens
 * show. Every sentence is derived from a number the engine actually produced;
 * nothing here adds a view the engine does not hold.
 */
import type { Action, Currency, SignalResult } from '../types';

/** One line per advice tier, for under the badge. */
export const ACTION_PLAIN: Record<Action, string> = {
  ACCUMULATE_STRONG: 'Conditions look favourable: buy more than usual.',
  ACCUMULATE: 'Leaning positive: buy a bit more than usual.',
  HOLD: 'No strong view: stick with your usual amount.',
  REDUCE: 'Leaning cautious: buy less than usual.',
  EXIT: 'Conditions look poor: consider pausing your buys.',
};

const trendSentence = (s: SignalResult): string => {
  if (s.regime === 'BULL') {
    return s.regimeScore >= 3
      ? 'Bitcoin has been in an uptrend for months: its price is above its long-term average, and that average is rising.'
      : 'Bitcoin is mostly in an uptrend: most of the long-term checks point up, though not all of them.';
  }
  if (s.regime === 'BEAR') {
    return s.regimeScore <= -3
      ? 'Bitcoin has been in a downtrend: its price is below its long-term average, and that average is falling.'
      : 'Bitcoin is mostly in a downtrend: most of the long-term checks point down, though not all of them.';
  }
  return "There's no clear long-term trend at the moment: the long-term checks are mixed.";
};

const nowSentence = (s: SignalResult): string => {
  const where =
    s.stretchScore > 0.3
      ? 'Over the last few weeks it has risen quickly, so it is at the pricey end of its recent range'
      : s.stretchScore < -0.3
      ? 'It has fallen quickly over the last few weeks, so it is at the cheap end of its recent range'
      : 'Right now it is around the middle of its recent range';
  const push =
    s.momentumScore > 0.15
      ? ', and the short-term push is upwards.'
      : s.momentumScore < -0.15
      ? ', and the short-term push is downwards.'
      : ', with no strong short-term push either way.';
  return where + push;
};

const moodSentence = (value: number | null, label: string | null): string | null => {
  if (value == null) return null;
  const mood = (label ?? '').toLowerCase() || 'neutral';
  if (value <= 20) return `The market mood is extreme fear (${value} out of 100). Panic like this has more often come near low points than high ones, so the app leans slightly towards buying.`;
  if (value >= 80) return `The market mood is extreme greed (${value} out of 100). Euphoria like this has more often come near high points, so the app leans slightly against buying.`;
  return `The market mood is ${mood} (${value} out of 100), which is not extreme enough to change the advice.`;
};

const adviceSentence = (s: SignalResult, currency: Currency): string => {
  const sym = currency === 'GBP' ? '£' : '$';
  const m = s.dcaMultiplier;
  if (m >= 1.05) {
    return `So the app suggests buying more than usual: about ${m}× your normal amount this time (${sym}${Math.round(m * 100)} if you usually put in ${sym}100).`;
  }
  if (m > 0.95) return 'So the app suggests buying your usual amount this time.';
  if (m > 0.05) {
    return `So the app suggests buying less than usual: about ${m}× your normal amount (${sym}${Math.round(m * 100)} instead of ${sym}100), keeping the rest as cash.`;
  }
  return 'So the app suggests pausing your buys for now and keeping the cash.';
};

const convictionSentence = (s: SignalResult): string =>
  s.conviction >= 70
    ? `Its different readings mostly agree (conviction ${s.conviction}%), so this is a fairly clear call.`
    : s.conviction >= 40
    ? `Its different readings partly disagree (conviction ${s.conviction}%), so this is a middling call.`
    : `Its different readings disagree (conviction ${s.conviction}%), so treat this as a weak call.`;

/** A short paragraph-by-paragraph summary of the market and the advice. */
export const describeMarket = (
  s: SignalResult,
  fearGreed: number | null,
  fearGreedLabel: string | null,
  currency: Currency
): string[] =>
  [
    trendSentence(s),
    nowSentence(s),
    moodSentence(fearGreed, fearGreedLabel),
    `${adviceSentence(s, currency)} ${convictionSentence(s)}`,
    'This is a rules-based reading of past prices, not a prediction.',
  ].filter((x): x is string => x != null);
