/**
 * Deterministic, rules-based signal engine.
 *
 * ---------------------------------------------------------------------------
 * Why this is not "nine indicators, one vote each"
 * ---------------------------------------------------------------------------
 * The previous engine gave RSI, StochRSI, Bollinger %B, MACD, EMA cross, SMA
 * cross, volume, ATR and support/resistance one equal vote each and averaged
 * them. Three problems made that unusable:
 *
 *  1. Those nine readings are not nine independent opinions. RSI, StochRSI and
 *     Bollinger %B are all mean-reversion reads of the same close series;
 *     MACD, the EMA cross and the SMA cross are all trend reads of the same
 *     close series. Averaging them counts one opinion several times.
 *  2. Three of the nine could never vote (ATR was hardcoded neutral, the
 *     volume rule was unreachable, support/resistance was broken), yet they
 *     stayed in the denominator. The top and bottom tiers became unreachable:
 *     over 2,000 simulated series, STRONG BUY and STRONG SELL never once fired.
 *  3. Mean-reversion and trend readings cancel out in exactly the trending
 *     markets where the call matters, so the output was NEUTRAL ~63% of the time.
 *
 * Instead, readings are grouped into families, each family collapses to a
 * single score, and the families are combined in a fixed hierarchy:
 *
 *     REGIME  (slow, dominant)   where are we in the cycle?
 *       |                        price vs SMA200, SMA50 vs SMA200, SMA200 slope
 *       v
 *     STRETCH (fast, modulating) how far is price extended right now?
 *       |                        RSI, StochRSI, Bollinger %B  -> one score
 *       v
 *     MOMENTUM (confirming)      is the move accelerating or fading?
 *                                MACD histogram, EMA 9/21 spread -> one score
 *
 * The regime sets a base allocation; stretch and momentum adjust it within a
 * band. Mean-reversion never flips the call against a strong trend, it only
 * changes how eagerly you deploy inside it. That is the single most important
 * behavioural fix: the old engine called a healthy bull market "bearish"
 * because RSI sat above 60 for weeks.
 *
 * ---------------------------------------------------------------------------
 * Output is an allocation, not a trade call
 * ---------------------------------------------------------------------------
 * For someone accumulating Bitcoin over years, the actionable question is not
 * "buy or sell?" but "how much of my intended exposure should I be holding,
 * and should this month's contribution be larger or smaller than usual?".
 * A continuous target allocation is also far more robust to backtest than a
 * binary in/out rule, and it degrades gracefully when the signal is unclear.
 *
 * Every parameter lives in `DEFAULT_CONFIG` so the backtester can sweep them.
 */
import type {
  Indicators,
  SignalResult,
  IndicatorReading,
  SignalDirection,
  Regime,
  Action,
  SignalConfig,
  PriceProjections,
} from '../types';

export const DEFAULT_CONFIG: SignalConfig = {
  // Regime thresholds
  sma200SlopeBullPct: 0.5,   // 200 SMA up >0.5% over 20 bars => trend up
  sma200SlopeBearPct: -0.5,
  // A market sitting within this distance of its long-term average is
  // directionless, not bearish. Without the deadband a perfectly flat series
  // scored -2 (BEAR), because `price > sma` is false when they are equal and
  // the comparison fell straight through to the bearish branch.
  regimeDeadbandPct: 1.0,
  regimeBullScore: 2,        // of a possible 3
  regimeBearScore: -2,

  // Base allocation per regime (fraction of the intended BTC sleeve)
  baseAllocationBull: 1.0,
  baseAllocationNeutral: 0.6,
  baseAllocationBear: 0.25,

  // How far stretch and momentum may move the base allocation.
  //
  // stretchWeight was 0.25 and is now 0.15. `yarn backtest --sweep` shows a
  // monotone pattern across every (bear allocation, rebalance band) pair
  // tested: 0.15 beats both 0 and 0.25, and 0.4 is catastrophic, because a
  // heavy mean-reversion weight drags the target allocation across the
  // rebalance band constantly and you pay a fee every time. At 0.4 the engine
  // made over 500 trades where the regime layer alone made 72. This is a
  // cost-of-churn effect, not a curve fit, which is why it is trusted enough
  // to change a default. Re-run the sweep on your own data to confirm.
  stretchWeight: 0.15,
  momentumWeight: 0.10,

  // Sentiment (Fear & Greed) is contrarian, and only at genuine extremes
  sentimentExtremeFear: 20,
  sentimentExtremeGreed: 80,
  sentimentWeight: 0.10,

  // Rebalance band: ignore drift smaller than this to avoid churning fees.
  // Widened from 0.15 to 0.20 for the same reason as above: fewer, larger
  // rebalances keep more of the return than many small ones.
  rebalanceBand: 0.20,

  // Display-only RSI thresholds (do not drive the allocation)
  rsiOverbought: 70,
  rsiOversold: 30,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Map a value in [lo, hi] onto [-1, 1], clamped outside that range. */
const normalise = (v: number, lo: number, hi: number): number =>
  hi === lo ? 0 : clamp(((v - lo) / (hi - lo)) * 2 - 1, -1, 1);

// ===== Layer 1: regime =====

export interface RegimeResult {
  regime: Regime;
  score: number;         // -3 .. +3
  components: { label: string; value: number; detail: string }[];
}

export const detectRegime = (ind: Indicators, config: SignalConfig = DEFAULT_CONFIG): RegimeResult => {
  const components: RegimeResult['components'] = [];
  let score = 0;

  const dead = config.regimeDeadbandPct;

  const pv200 = ind?.priceVsSma200Pct;
  if (pv200 != null) {
    const v = pv200 > dead ? 1 : pv200 < -dead ? -1 : 0;
    score += v;
    components.push({
      label: 'Price vs 200 SMA',
      value: v,
      detail:
        v === 0
          ? `Price is sitting on its 200-period average (within ${dead}%), which is neither bullish nor bearish.`
          : `Price is ${Math.abs(pv200).toFixed(1)}% ${v > 0 ? 'above' : 'below'} its 200-period average.`,
    });
  }

  if (ind?.sma50 != null && ind?.sma200 != null && ind.sma200 > 0) {
    const gap = ((ind.sma50 - ind.sma200) / ind.sma200) * 100;
    const v = gap > dead ? 1 : gap < -dead ? -1 : 0;
    score += v;
    components.push({
      label: '50 vs 200 SMA',
      value: v,
      detail:
        v === 0
          ? `The 50- and 200-period averages are within ${dead}% of each other, so the trend is unresolved.`
          : `The 50-period average is ${Math.abs(gap).toFixed(1)}% ${v > 0 ? 'above' : 'below'} the 200-period average.`,
    });
  }

  const slope = ind?.sma200Slope;
  if (slope != null) {
    const v = slope > config.sma200SlopeBullPct ? 1 : slope < config.sma200SlopeBearPct ? -1 : 0;
    score += v;
    components.push({
      label: '200 SMA slope',
      value: v,
      detail: `The long-term average has moved ${slope >= 0 ? '+' : ''}${slope.toFixed(1)}% over the last 20 periods.`,
    });
  }

  const regime: Regime =
    score >= config.regimeBullScore ? 'BULL' : score <= config.regimeBearScore ? 'BEAR' : 'NEUTRAL';

  return { regime, score, components };
};

// ===== Layer 2: stretch (mean reversion, collapsed to one score) =====

export interface FamilyScore {
  score: number;  // -1 .. +1
  parts: { name: string; raw: number; normalised: number }[];
}

export const computeStretch = (ind: Indicators, currentPrice: number): FamilyScore => {
  const parts: FamilyScore['parts'] = [];

  if (ind?.rsi) {
    // 30/70 is the conventional stretch band, so map it onto the full -1..1.
    parts.push({ name: 'RSI', raw: ind.rsi.value, normalised: normalise(ind.rsi.value, 30, 70) });
  }
  if (ind?.stochRSI) {
    parts.push({ name: 'StochRSI', raw: ind.stochRSI.k, normalised: normalise(ind.stochRSI.k, 20, 80) });
  }
  if (ind?.bollingerBands && currentPrice > 0) {
    const { upper, lower } = ind.bollingerBands;
    const pctB = upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;
    parts.push({ name: 'Bollinger %B', raw: pctB * 100, normalised: normalise(pctB, 0, 1) });
  }

  const score = parts.length ? parts.reduce((a, p) => a + p.normalised, 0) / parts.length : 0;
  return { score: clamp(score, -1, 1), parts };
};

// ===== Layer 3: momentum (confirming, collapsed to one score) =====

export const computeMomentum = (ind: Indicators, currentPrice: number): FamilyScore => {
  const parts: FamilyScore['parts'] = [];

  if (ind?.macd && currentPrice > 0) {
    // Histogram scaled by price so the number means the same at $8k and $80k.
    const hist = (ind.macd.histogram / currentPrice) * 100;
    parts.push({ name: 'MACD histogram', raw: ind.macd.histogram, normalised: normalise(hist, -1.5, 1.5) });
  }
  if (ind?.ema9 != null && ind?.ema21 != null && ind.ema21 > 0) {
    const spread = ((ind.ema9 - ind.ema21) / ind.ema21) * 100;
    parts.push({ name: 'EMA 9/21 spread', raw: spread, normalised: normalise(spread, -3, 3) });
  }

  const score = parts.length ? parts.reduce((a, p) => a + p.normalised, 0) / parts.length : 0;
  return { score: clamp(score, -1, 1), parts };
};

// ===== Combination =====

const actionForAllocation = (alloc: number): Action => {
  if (alloc >= 0.85) return 'ACCUMULATE_STRONG';
  if (alloc >= 0.65) return 'ACCUMULATE';
  if (alloc >= 0.40) return 'HOLD';
  if (alloc >= 0.20) return 'REDUCE';
  return 'EXIT';
};

export const ACTION_LABEL: Record<Action, string> = {
  ACCUMULATE_STRONG: 'ACCUMULATE HARD',
  ACCUMULATE: 'ACCUMULATE',
  HOLD: 'HOLD',
  REDUCE: 'REDUCE',
  EXIT: 'STAND ASIDE',
};

export interface SignalEngineInput {
  indicators: Indicators;
  currentPrice: number;
  fearGreed?: number | null;
  config?: SignalConfig;
}

export const computeSignal = ({
  indicators,
  currentPrice,
  fearGreed = null,
  config = DEFAULT_CONFIG,
}: SignalEngineInput): SignalResult => {
  const regimeResult = detectRegime(indicators, config);
  const stretch = computeStretch(indicators, currentPrice);
  const momentum = computeMomentum(indicators, currentPrice);

  const base =
    regimeResult.regime === 'BULL'
      ? config.baseAllocationBull
      : regimeResult.regime === 'BEAR'
      ? config.baseAllocationBear
      : config.baseAllocationNeutral;

  // Oversold (negative stretch) raises the allocation, overbought lowers it.
  const stretchAdj = -stretch.score * config.stretchWeight;
  const momentumAdj = momentum.score * config.momentumWeight;

  // Sentiment only speaks at extremes, and speaks against the crowd.
  let sentimentAdj = 0;
  if (fearGreed != null) {
    if (fearGreed <= config.sentimentExtremeFear) sentimentAdj = config.sentimentWeight;
    else if (fearGreed >= config.sentimentExtremeGreed) sentimentAdj = -config.sentimentWeight;
  }

  const targetAllocation = clamp(base + stretchAdj + momentumAdj + sentimentAdj, 0, 1);
  const action = actionForAllocation(targetAllocation);

  // Conviction measures AGREEMENT BETWEEN INDEPENDENT FAMILIES, which is real
  // information the action does not already carry. The old "confidence" was
  // |score|/count, arithmetically the same quantity that picked the badge
  // sitting next to it, so it told the user nothing.
  //
  // Contributions are weighted by MAGNITUDE, not just sign. Taking bare signs
  // reproduces the very flaw this engine exists to fix: a stretch score of
  // 1e-17 would otherwise count as a full-strength vote against the trend and
  // drag conviction down by a third.
  const weights = [2, 1, 1];                                   // regime leads
  const scores = [regimeResult.score / 3, momentum.score, -stretch.score];
  const signed = scores.reduce((a, s, i) => a + weights[i]! * s, 0);
  const absolute = scores.reduce((a, s, i) => a + weights[i]! * Math.abs(s), 0);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // How aligned the families are, 0..1. Undefined when nothing is speaking.
  const agreement = absolute > 1e-9 ? Math.abs(signed) / absolute : 0;
  // How much signal there is at all, so a quiet market cannot score highly
  // just because its one faint reading has nothing to disagree with.
  const strength = absolute / totalWeight;
  // A 3-of-3 regime deserves more weight than a 2-of-3 one.
  const regimeStrength = Math.abs(regimeResult.score) / 3;

  const conviction = Math.round(
    clamp(agreement * 0.5 + regimeStrength * 0.3 + strength * 0.2, 0, 1) * 100
  );

  const readings = buildReadings(indicators, currentPrice, regimeResult, stretch, momentum, fearGreed, config);

  return {
    regime: regimeResult.regime,
    regimeScore: regimeResult.score,
    regimeComponents: regimeResult.components,
    action,
    actionLabel: ACTION_LABEL[action],
    targetAllocation,
    // A multiplier on the user's normal periodic contribution. 0.6 allocation
    // is the neutral anchor, so a neutral market leaves DCA untouched at 1.0x.
    dcaMultiplier: Math.round(clamp(targetAllocation / 0.6, 0, 2) * 10) / 10,
    conviction,
    stretchScore: stretch.score,
    momentumScore: momentum.score,
    readings,
    projections: buildProjections(indicators, currentPrice),
  };
};

// ===== Human-readable breakdown =====

const directionOf = (n: number, deadband = 0.15): SignalDirection =>
  n > deadband ? 'BULLISH' : n < -deadband ? 'BEARISH' : 'NEUTRAL';

const buildReadings = (
  ind: Indicators,
  price: number,
  regime: RegimeResult,
  stretch: FamilyScore,
  momentum: FamilyScore,
  fearGreed: number | null,
  config: SignalConfig
): IndicatorReading[] => {
  const readings: IndicatorReading[] = [];

  readings.push({
    name: 'Market regime',
    family: 'REGIME',
    value: regime.regime,
    signal: directionOf(regime.score / 3, 0.3),
    weight: 'Primary',
    explanation:
      regime.components.map((c) => c.detail).join(' ') +
      ` Regime score ${regime.score >= 0 ? '+' : ''}${regime.score} of ±3. ` +
      (regime.regime === 'BULL'
        ? 'In an uptrend, dips are treated as opportunities to add rather than reasons to sell.'
        : regime.regime === 'BEAR'
        ? 'In a downtrend, rallies are treated as chances to reduce rather than reasons to chase.'
        : 'With no clear trend, exposure sits near neutral and position changes stay small.'),
  });

  readings.push({
    name: 'Price stretch',
    family: 'STRETCH',
    value: `${stretch.score >= 0 ? '+' : ''}${(stretch.score * 100).toFixed(0)}%`,
    signal: directionOf(-stretch.score),
    weight: `±${(config.stretchWeight * 100).toFixed(0)}% allocation`,
    explanation:
      `How far price is extended from its recent range, combining ${stretch.parts.map((p) => p.name).join(', ')} ` +
      `into one reading because they measure the same thing. ` +
      (stretch.score < -0.3
        ? 'Price is stretched to the downside, which argues for deploying more than usual.'
        : stretch.score > 0.3
        ? 'Price is stretched to the upside, which argues for holding back rather than chasing.'
        : 'Price sits mid-range, so this layer barely moves the allocation.') +
      ` Components: ${stretch.parts.map((p) => `${p.name} ${p.raw.toFixed(1)}`).join(', ')}.`,
  });

  readings.push({
    name: 'Momentum',
    family: 'MOMENTUM',
    value: `${momentum.score >= 0 ? '+' : ''}${(momentum.score * 100).toFixed(0)}%`,
    signal: directionOf(momentum.score),
    weight: `±${(config.momentumWeight * 100).toFixed(0)}% allocation`,
    explanation:
      `Whether the current move is accelerating or fading, from ${momentum.parts.map((p) => p.name).join(' and ')}. ` +
      'This only confirms or tempers the regime call, it never overrides it.',
  });

  if (fearGreed != null) {
    const extreme = fearGreed <= config.sentimentExtremeFear || fearGreed >= config.sentimentExtremeGreed;
    readings.push({
      name: 'Fear & Greed',
      family: 'SENTIMENT',
      value: String(fearGreed),
      signal: extreme ? (fearGreed <= config.sentimentExtremeFear ? 'BULLISH' : 'BEARISH') : 'NEUTRAL',
      weight: extreme ? `±${(config.sentimentWeight * 100).toFixed(0)}% allocation` : 'Inactive',
      explanation: extreme
        ? fearGreed <= config.sentimentExtremeFear
          ? `Extreme fear (${fearGreed}). Crowd sentiment is used contrarily, and only at extremes, so this nudges the allocation up.`
          : `Extreme greed (${fearGreed}). This nudges the allocation down.`
        : `Sentiment at ${fearGreed} is not extreme, so it does not affect the allocation. It only acts below ${config.sentimentExtremeFear} or above ${config.sentimentExtremeGreed}.`,
    });
  }

  // Volatility is context, not a directional vote. The old engine gave ATR a
  // vote it could never cast; here it sizes expectations instead.
  if (ind?.atrPct != null && ind?.atr != null) {
    readings.push({
      name: 'Volatility (ATR)',
      family: 'CONTEXT',
      value: `$${ind.atr.toFixed(0)} (${ind.atrPct.toFixed(1)}%)`,
      signal: 'NEUTRAL',
      weight: 'Context only',
      explanation:
        `Average daily range is ${ind.atrPct.toFixed(1)}% of price. ` +
        (ind.atrPct > 4
          ? 'Volatility is high, so expect wide swings and size positions smaller than usual.'
          : ind.atrPct < 1.5
          ? 'Volatility is unusually low. Quiet periods often precede large moves, in either direction.'
          : 'Volatility is around normal for Bitcoin.') +
        ' This is deliberately not a buy or sell vote, it describes the weather.',
    });
  }

  const sr = ind?.supportResistance;
  if (sr && (sr.supports.length || sr.resistances.length)) {
    const s = sr.supports[0] ?? null;
    const r = sr.resistances[0] ?? null;
    readings.push({
      name: 'Nearest levels',
      family: 'CONTEXT',
      value: `S: ${s ? '$' + s.toFixed(0) : 'n/a'}  R: ${r ? '$' + r.toFixed(0) : 'n/a'}`,
      signal: 'NEUTRAL',
      weight: 'Context only',
      explanation:
        'Recent swing pivots where price actually turned, ordered nearest first. ' +
        (s && price > 0 ? `Nearest support is ${(((price - s) / price) * 100).toFixed(1)}% below. ` : '') +
        (r && price > 0 ? `Nearest resistance is ${(((r - price) / price) * 100).toFixed(1)}% above. ` : '') +
        'Useful for placing orders, but not used to generate the allocation.',
    });
  }

  return readings;
};

/**
 * Volatility-scaled expectation bands.
 *
 * These are explicitly NOT forecasts. They answer "given recent volatility,
 * what is a normal range?" and are scaled by the square root of time, which is
 * the correct scaling for a random walk. The old code multiplied a one-day ATR
 * by 3 for a seven-day "scenario" and printed it to the dollar, which implied
 * a precision and a directional view it did not have.
 */
const buildProjections = (ind: Indicators, price: number): PriceProjections | null => {
  if (price <= 0 || ind?.atr == null) return null;
  const atr = ind.atr;
  const sqrt7 = Math.sqrt(7);
  return {
    range1d: { low: price - atr, high: price + atr },
    range7d: { low: price - atr * sqrt7, high: price + atr * sqrt7 },
    nextSupport: ind.supportResistance?.supports?.[0] ?? null,
    nextResistance: ind.supportResistance?.resistances?.[0] ?? null,
    note: 'Typical volatility range, not a forecast. Roughly two thirds of periods land inside the 1-day band.',
  };
};
