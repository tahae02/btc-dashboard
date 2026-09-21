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
  refresh: () => Promise<void>;
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
}

// ===== Signal Engine =====
export type SignalStrength = 'STRONG BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG SELL';
export type SignalDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface IndicatorSignal {
  name: string;
  value: string;
  signal: SignalDirection;
  explanation: string;
  thresholds?: string;
}

export interface SignalResult {
  overall: SignalStrength;
  confidence: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  indicators: IndicatorSignal[];
  entryPrice: number | null;
  exitPrice: number | null;
  projections: PriceProjections | null;
}

export interface PriceProjections {
  range24h: { low: number; high: number };
  scenario7d: { bull: number; base: number; bear: number };
  nextResistance: number | null;
  nextSupport: number | null;
}

// ===== Settings =====
export type RefreshInterval = 'manual' | '1min' | '5min';
export type Currency = 'USD' | 'GBP';

export interface Settings {
  refreshInterval: RefreshInterval;
  currency: Currency;
  rsiOverbought: number;
  rsiOversold: number;
  volumeSpikeMultiplier: number;
}

export type Timeframe = '1H' | '4H' | '1D' | '1W';
