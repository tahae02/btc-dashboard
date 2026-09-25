import { useMemo } from 'react';
import { Indicators, SignalResult, Settings, SignalConfig } from '../types';
import { computeSignal, DEFAULT_CONFIG } from '../services/signalEngine';

type SignalSettings = Partial<Pick<Settings, 'rsiOverbought' | 'rsiOversold' | 'stretchWeight'>>;

interface SignalInput {
  indicators: Indicators;
  currentPrice: number;
  fearGreed?: number | null;
  settings?: SignalSettings;
}

/**
 * User settings folded into the engine config. Shared so the track record
 * replays the engine exactly as the live screens run it.
 */
export const configFromSettings = (settings?: SignalSettings): SignalConfig => ({
  ...DEFAULT_CONFIG,
  rsiOverbought: settings?.rsiOverbought ?? DEFAULT_CONFIG.rsiOverbought,
  rsiOversold: settings?.rsiOversold ?? DEFAULT_CONFIG.rsiOversold,
  stretchWeight: settings?.stretchWeight ?? DEFAULT_CONFIG.stretchWeight,
});

/**
 * Thin wrapper over the pure engine in `src/services/signalEngine.ts`.
 */
export const useSignalEngine = ({ indicators, currentPrice, fearGreed = null, settings }: SignalInput): SignalResult =>
  useMemo(
    () => computeSignal({ indicators, currentPrice, fearGreed, config: configFromSettings(settings) }),
    [indicators, currentPrice, fearGreed, settings?.rsiOverbought, settings?.rsiOversold, settings?.stretchWeight]
  );
