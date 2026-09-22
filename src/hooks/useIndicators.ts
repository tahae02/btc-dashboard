import { useMemo } from 'react';
import { OHLCVCandle, Indicators, Timeframe } from '../types';
import { computeIndicators } from '../services/indicators';
import { dropIncompleteCandle } from '../services/candles';

/**
 * Indicators for a candle series.
 *
 * The maths lives in `src/services/indicators.ts` as pure functions so the
 * backtester and the test suite exercise exactly the same code the app runs.
 *
 * The still-forming final bar is dropped before computing: see
 * `src/services/candles.ts` for why that matters.
 */
export const useIndicators = (candles: OHLCVCandle[], timeframe: Timeframe = '1D'): Indicators =>
  useMemo(() => computeIndicators(dropIncompleteCandle(candles ?? [], timeframe)), [candles, timeframe]);
