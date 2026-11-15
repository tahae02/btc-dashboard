import { Platform } from 'react-native';

export const Colors = {
  background: '#0A0A0F',
  card: '#12121A',
  cardBorder: '#1E1E2A',
  elevated: '#1A1A28',
  shimmerBase: '#1A1A28',
  shimmerHighlight: '#252538',
  accent: '#00D2FF',
  // Paper trading has its own colour, so a paper screen can never be mistaken
  // for your real holdings at a glance.
  paper: '#B388FF',
  bullish: '#00E676',
  bearish: '#FF1744',
  neutral: '#FFB300',
  textPrimary: '#E8E8F0',
  // Both greys pass the 4.5:1 reading standard on the card background
  // (#A0A0B8 is 7.3:1, #80809A is 4.9:1). The faintest used to be #555570,
  // about 2.6:1, which made small print hard to read outdoors.
  textSecondary: '#A0A0B8',
  textTertiary: '#80809A',
  glassBackground: 'rgba(18,18,26,0.8)',
  glassBorder: 'rgba(255,255,255,0.06)',
  strongBuy: '#00E676',
  buy: '#66BB6A',
  sell: '#FF5252',
  strongSell: '#FF1744',
  // Regime colours: a bear regime is a state of the market, not an alarm, so
  // it reads amber-to-red rather than the same red as a sell signal.
  regimeBull: '#00E676',
  regimeNeutral: '#FFB300',
  regimeBear: '#FF7043',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 20,
  full: 9999,
} as const;

const monoFont = Platform.select({
  ios: 'Courier',
  android: 'monospace',
  default: 'monospace',
});

const systemFont = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'Arial, sans-serif',
});

export const Fonts = {
  /** Real monospace, only for pasted backup text. Numbers use `Numbers` below. */
  mono: monoFont ?? 'monospace',
  system: systemFont ?? 'Arial, sans-serif',
} as const;

/**
 * Prices and figures: the normal font with even-width digits, so columns of
 * numbers line up without the typewriter look of a monospace font.
 */
export const Numbers = {
  fontFamily: Fonts.system,
  fontVariant: ['tabular-nums'] as ('tabular-nums')[],
};

export const Typography = {
  display: { fontSize: 32, fontWeight: '700' as const, fontFamily: Fonts.system, color: Colors.textPrimary },
  heading: { fontSize: 22, fontWeight: '600' as const, fontFamily: Fonts.system, color: Colors.textPrimary },
  subheading: { fontSize: 18, fontWeight: '600' as const, fontFamily: Fonts.system, color: Colors.textPrimary },
  body: { fontSize: 16, fontWeight: '400' as const, fontFamily: Fonts.system, color: Colors.textPrimary },
  caption: { fontSize: 12, fontWeight: '400' as const, fontFamily: Fonts.system, color: Colors.textSecondary },
  monoData: { fontSize: 14, fontWeight: '500' as const, ...Numbers, color: Colors.textPrimary },
  priceDisplay: { fontSize: 32, fontWeight: '700' as const, ...Numbers, color: Colors.textPrimary, letterSpacing: -0.5 },
} as const;

export const getSignalColor = (signal: string): string => {
  switch (signal) {
    case 'ACCUMULATE_STRONG':
    case 'ACCUMULATE HARD': return Colors.strongBuy;
    case 'ACCUMULATE': return Colors.buy;
    case 'HOLD': return Colors.neutral;
    case 'REDUCE': return Colors.sell;
    case 'EXIT':
    case 'STAND ASIDE': return Colors.strongSell;
    case 'BULLISH': return Colors.bullish;
    case 'BEARISH': return Colors.bearish;
    default: return Colors.neutral;
  }
};

export const getRegimeColor = (regime: string): string => {
  switch (regime) {
    case 'BULL': return Colors.regimeBull;
    case 'BEAR': return Colors.regimeBear;
    default: return Colors.regimeNeutral;
  }
};
