import { Platform } from 'react-native';

export const Colors = {
  background: '#0A0A0F',
  card: '#12121A',
  cardBorder: '#1E1E2A',
  elevated: '#1A1A28',
  shimmerBase: '#1A1A28',
  shimmerHighlight: '#252538',
  accent: '#00D2FF',
  bullish: '#00E676',
  bearish: '#FF1744',
  neutral: '#FFB300',
  textPrimary: '#E8E8F0',
  textSecondary: '#8888A0',
  textTertiary: '#555570',
  glassBackground: 'rgba(18,18,26,0.8)',
  glassBorder: 'rgba(255,255,255,0.06)',
  strongBuy: '#00E676',
  buy: '#66BB6A',
  sell: '#FF5252',
  strongSell: '#FF1744',
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
  mono: monoFont ?? 'monospace',
  system: systemFont ?? 'Arial, sans-serif',
} as const;

export const Typography = {
  display: { fontSize: 32, fontWeight: '700' as const, fontFamily: Fonts.system, color: Colors.textPrimary },
  heading: { fontSize: 22, fontWeight: '600' as const, fontFamily: Fonts.system, color: Colors.textPrimary },
  subheading: { fontSize: 18, fontWeight: '600' as const, fontFamily: Fonts.system, color: Colors.textPrimary },
  body: { fontSize: 16, fontWeight: '400' as const, fontFamily: Fonts.system, color: Colors.textPrimary },
  caption: { fontSize: 12, fontWeight: '400' as const, fontFamily: Fonts.system, color: Colors.textSecondary },
  monoData: { fontSize: 14, fontWeight: '500' as const, fontFamily: Fonts.mono, color: Colors.textPrimary },
  priceDisplay: { fontSize: 28, fontWeight: '700' as const, fontFamily: Fonts.mono, color: Colors.textPrimary },
} as const;

export const getSignalColor = (signal: string): string => {
  switch (signal) {
    case 'STRONG BUY': return Colors.strongBuy;
    case 'BUY': return Colors.buy;
    case 'SELL': return Colors.sell;
    case 'STRONG SELL': return Colors.strongSell;
    case 'BULLISH': return Colors.bullish;
    case 'BEARISH': return Colors.bearish;
    default: return Colors.neutral;
  }
};
