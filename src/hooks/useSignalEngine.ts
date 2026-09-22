import { useMemo } from 'react';
import { Indicators, SignalResult, Settings } from '../types';
import { computeSignal, DEFAULT_CONFIG } from '../services/signalEngine';

interface SignalInput {
  indicators: Indicators;
  currentPrice: number;
  fearGreed?: number | null;
  settings?: Partial<Pick<Settings, 'rsiOverbought' | 'rsiOversold' | 'stretchWeight'>>;
}

/**
 * Thin wrapper over the pure engine in `src/services/signalEngine.ts`.
 * User settings are folded into the engine config here.
 */
export const useSignalEngine = ({ indicators, currentPrice, fearGreed = null, settings }: SignalInput): SignalResult =>
  useMemo(
    () =>
      computeSignal({
        indicators,
        currentPrice,
        fearGreed,
        config: {
          ...DEFAULT_CONFIG,
          rsiOverbought: settings?.rsiOverbought ?? DEFAULT_CONFIG.rsiOverbought,
          rsiOversold: settings?.rsiOversold ?? DEFAULT_CONFIG.rsiOversold,
          stretchWeight: settings?.stretchWeight ?? DEFAULT_CONFIG.stretchWeight,
        },
      }),
    [indicators, currentPrice, fearGreed, settings?.rsiOverbought, settings?.rsiOversold, settings?.stretchWeight]
  );
