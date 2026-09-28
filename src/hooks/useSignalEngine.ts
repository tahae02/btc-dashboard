import { useMemo } from 'react';
import { Indicators, SignalResult, Settings } from '../types';
import { computeSignal, configFromSettings } from '../services/signalEngine';

type SignalSettings = Partial<Pick<Settings, 'rsiOverbought' | 'rsiOversold' | 'stretchWeight'>>;

interface SignalInput {
  indicators: Indicators;
  currentPrice: number;
  fearGreed?: number | null;
  settings?: SignalSettings;
}

// Lives with the engine so the snapshot can use it without React.
export { configFromSettings };

/**
 * Thin wrapper over the pure engine in `src/services/signalEngine.ts`.
 */
export const useSignalEngine = ({ indicators, currentPrice, fearGreed = null, settings }: SignalInput): SignalResult =>
  useMemo(
    () => computeSignal({ indicators, currentPrice, fearGreed, config: configFromSettings(settings) }),
    [indicators, currentPrice, fearGreed, settings?.rsiOverbought, settings?.rsiOversold, settings?.stretchWeight]
  );
