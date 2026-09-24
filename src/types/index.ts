// ===== Market Data Types =====
export interface PriceData {
  price: number;
  price_gbp: number;
  market_cap: number;
  volume_24h: number;
  change_24h: number;
  change_24h_pct: number;
  high_24h: number;
  low_24h: number;
  circulating_supply: number;
  last_updated: number;
}

export interface OHLCVCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface FearGreedEntry {
  value: number;
  value_classification: string;
  timestamp: string;
}

export interface FearGreedData {
  current: FearGreedEntry;
  history: FearGreedEntry[];
}

export interface MempoolStats {
  count: number;
  vsize: number;
  total_fee: number;
}

export interface FeeEstimates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  minimumFee: number;
}

export interface DifficultyAdjustment {
  progressPercent: number;
  difficultyChange: number;
  estimatedRetargetDate: number;
  remainingBlocks: number;
  remainingTime: number;
  previousRetarget: number;
  nextRetargetHeight: number;
  timeAvg: number;
  timeOffset: number;
  expectedBlocks: number;
}

export interface OnChainData {
  hashRate: number;
  difficulty: DifficultyAdjustment | null;
  mempool: MempoolStats | null;
  fees: FeeEstimates | null;
}

export interface MarketData {
  price: PriceData | null;
  ohlcv: Record<Timeframe, OHLCVCandle[]>;
  fearGreed: FearGreedData | null;
  onChain: OnChainData;
  btcDominance: number | null;
  isLoading: boolean;
  lastUpdated: Date | null;
  error: string | null;
  /**
   * 'offline' when there is no live price or history at all; 'partial' when
   * only extras (dominance, sentiment, on-chain) failed and the core is live.
   */
  errorKind: 'offline' | 'partial' | null;
  /** Human-readable names of the sources that failed on the last refresh. */
  failedSources: string[];
  refresh: () => Promise<void>;
  loadTimeframe: (tf: Timeframe) => Promise<void>;
}

// ===== Technical Indicators =====
export interface RSIResult {
  value: number;
  values: number[];
}

export interface MACDResult {
  macdLine: number;
  signalLine: number;
  histogram: number;
  macdValues: number[];
  signalValues: number[];
  histogramValues: number[];
}

export interface BollingerBandsResult {
  upper: number;
  middle: number;
  lower: number;
  upperValues: number[];
  middleValues: number[];
  lowerValues: number[];
  bandwidth: number;
}

export interface StochRSIResult {
  k: number;
  d: number;
}

export interface SupportResistance {
  supports: number[];
  resistances: number[];
}

export interface Indicators {
  rsi: RSIResult | null;
  macd: MACDResult | null;
  bollingerBands: BollingerBandsResult | null;
  ema9: number | null;
  ema21: number | null;
  sma50: number | null;
  sma200: number | null;
  ema9Values: number[];
  ema21Values: number[];
  sma50Values: number[];
  sma200Values: number[];
  stochRSI: StochRSIResult | null;
  atr: number | null;
  volumeAvg20: number | null;
  currentVolume: number | null;
  supportResistance: SupportResistance;
  goldenCross: boolean;
  deathCross: boolean;
  /** % change of the 200 SMA over the last 20 bars. Primary trend read. */
  sma200Slope: number | null;
  /** Current price as a % above/below the 200 SMA. */
  priceVsSma200Pct: number | null;
  /** ATR as a % of price, so it is comparable across price levels. */
  atrPct: number | null;
}

// ===== Signal Engine =====
export type SignalDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

/** Slow-moving cycle read that dominates the allocation. */
export type Regime = 'BULL' | 'NEUTRAL' | 'BEAR';

/** What the engine advises doing with the Bitcoin sleeve right now. */
export type Action = 'ACCUMULATE_STRONG' | 'ACCUMULATE' | 'HOLD' | 'REDUCE' | 'EXIT';

/** Which layer of the hierarchy a reading belongs to. */
export type IndicatorFamily = 'REGIME' | 'STRETCH' | 'MOMENTUM' | 'SENTIMENT' | 'CONTEXT';

export interface IndicatorReading {
  name: string;
  family: IndicatorFamily;
  value: string;
  signal: SignalDirection;
  /** Honest statement of how much this reading can move the allocation. */
  weight: string;
  explanation: string;
}

export interface PriceProjections {
  range1d: { low: number; high: number };
  range7d: { low: number; high: number };
  nextSupport: number | null;
  nextResistance: number | null;
  note: string;
}

export interface SignalResult {
  regime: Regime;
  regimeScore: number;
  regimeComponents: { label: string; value: number; detail: string }[];
  action: Action;
  actionLabel: string;
  /** 0..1 target share of the intended Bitcoin sleeve. */
  targetAllocation: number;
  /** Multiplier on a regular periodic contribution. 1.0 = unchanged. */
  dcaMultiplier: number;
  /** 0..100 agreement between independent families. Not a restatement of action. */
  conviction: number;
  stretchScore: number;
  momentumScore: number;
  readings: IndicatorReading[];
  projections: PriceProjections | null;
}

/** Every tunable number, in one place, so the backtester can sweep them. */
export interface SignalConfig {
  sma200SlopeBullPct: number;
  sma200SlopeBearPct: number;
  regimeDeadbandPct: number;
  regimeBullScore: number;
  regimeBearScore: number;
  baseAllocationBull: number;
  baseAllocationNeutral: number;
  baseAllocationBear: number;
  stretchWeight: number;
  momentumWeight: number;
  sentimentExtremeFear: number;
  sentimentExtremeGreed: number;
  sentimentWeight: number;
  rebalanceBand: number;
  rsiOverbought: number;
  rsiOversold: number;
}

// ===== Settings =====
export type RefreshInterval = 'manual' | '1min' | '5min';
export type Currency = 'USD' | 'GBP';

export interface Settings {
  refreshInterval: RefreshInterval;
  currency: Currency;
  /** Timeframe the signal is computed on (the chart can differ). */
  signalTimeframe: Timeframe;
  rsiOverbought: number;
  rsiOversold: number;
  /** How far stretch may move the allocation. 0 disables mean reversion. */
  stretchWeight: number;
}

export type Timeframe = '1H' | '4H' | '1D' | '1W';
