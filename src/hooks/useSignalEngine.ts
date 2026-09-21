import { useMemo } from 'react';
import { Indicators, SignalResult, SignalStrength, SignalDirection, IndicatorSignal, PriceProjections, Settings } from '../types';

interface SignalInput {
  indicators: Indicators;
  currentPrice: number;
  settings: Pick<Settings, 'rsiOverbought' | 'rsiOversold' | 'volumeSpikeMultiplier'>;
}

const scoreMap: Record<SignalDirection, number> = { BULLISH: 1, NEUTRAL: 0, BEARISH: -1 };

const getOverallSignal = (score: number, count: number): SignalStrength => {
  if (count === 0) return 'NEUTRAL';
  const norm = score / count; // -1 to 1
  if (norm >= 0.6) return 'STRONG BUY';
  if (norm >= 0.2) return 'BUY';
  if (norm <= -0.6) return 'STRONG SELL';
  if (norm <= -0.2) return 'SELL';
  return 'NEUTRAL';
};

export const useSignalEngine = ({ indicators, currentPrice, settings }: SignalInput): SignalResult => {
  return useMemo(() => {
    const sigs: IndicatorSignal[] = [];
    const { rsiOverbought, rsiOversold, volumeSpikeMultiplier } = settings ?? {};

    // 1. RSI
    if (indicators?.rsi) {
      const v = indicators.rsi.value;
      let signal: SignalDirection = 'NEUTRAL';
      let explanation = '';
      if (v <= (rsiOversold ?? 30)) {
        signal = 'BULLISH';
        explanation = `RSI at ${v.toFixed(1)} is in oversold territory (below ${rsiOversold ?? 30}). This often precedes a price bounce as selling pressure exhausts.`;
      } else if (v <= 40) {
        signal = 'BULLISH';
        explanation = `RSI at ${v.toFixed(1)} is approaching oversold levels, suggesting potential buying opportunity.`;
      } else if (v >= (rsiOverbought ?? 70)) {
        signal = 'BEARISH';
        explanation = `RSI at ${v.toFixed(1)} is in overbought territory (above ${rsiOverbought ?? 70}). Price may face selling pressure.`;
      } else if (v >= 60) {
        signal = 'BEARISH';
        explanation = `RSI at ${v.toFixed(1)} is approaching overbought levels, suggesting caution.`;
      } else {
        explanation = `RSI at ${v.toFixed(1)} is in neutral range. No strong momentum signal.`;
      }
      sigs.push({ name: 'RSI (14)', value: v.toFixed(1), signal, explanation, thresholds: `Oversold < ${rsiOversold ?? 30} | Overbought > ${rsiOverbought ?? 70}` });
    }

    // 2. MACD
    if (indicators?.macd) {
      const { histogram, macdLine, signalLine } = indicators.macd;
      let signal: SignalDirection = 'NEUTRAL';
      let explanation = '';
      if (histogram > 0 && macdLine > signalLine) {
        signal = 'BULLISH';
        explanation = `MACD line is above signal line with positive histogram (${histogram.toFixed(0)}). Bullish momentum is increasing.`;
      } else if (histogram < 0 && macdLine < signalLine) {
        signal = 'BEARISH';
        explanation = `MACD line is below signal line with negative histogram (${histogram.toFixed(0)}). Bearish momentum prevails.`;
      } else {
        explanation = `MACD is near the signal line. Momentum is indecisive, watch for a crossover.`;
      }
      sigs.push({ name: 'MACD (12/26/9)', value: histogram.toFixed(0), signal, explanation });
    }

    // 3. Stochastic RSI
    if (indicators?.stochRSI) {
      const { k } = indicators.stochRSI;
      let signal: SignalDirection = 'NEUTRAL';
      let explanation = '';
      if (k <= 20) {
        signal = 'BULLISH';
        explanation = `StochRSI K at ${k.toFixed(1)} is in oversold zone (below 20), suggesting potential upward reversal.`;
      } else if (k >= 80) {
        signal = 'BEARISH';
        explanation = `StochRSI K at ${k.toFixed(1)} is in overbought zone (above 80), suggesting potential pullback.`;
      } else {
        explanation = `StochRSI K at ${k.toFixed(1)} is in neutral territory.`;
      }
      sigs.push({ name: 'Stochastic RSI', value: k.toFixed(1), signal, explanation, thresholds: 'Oversold < 20 | Overbought > 80' });
    }

    // 4. Bollinger Bands
    if (indicators?.bollingerBands && currentPrice > 0) {
      const { upper, lower, bandwidth } = indicators.bollingerBands;
      let signal: SignalDirection = 'NEUTRAL';
      let explanation = '';
      const pos = upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;
      if (pos <= 0.1) {
        signal = 'BULLISH';
        explanation = `Price is near the lower Bollinger Band, suggesting potential bounce. Band position: ${(pos * 100).toFixed(0)}%.`;
      } else if (pos >= 0.9) {
        signal = 'BEARISH';
        explanation = `Price is near the upper Bollinger Band, suggesting overbought conditions. Band position: ${(pos * 100).toFixed(0)}%.`;
      } else {
        explanation = `Price is within Bollinger Bands (${(pos * 100).toFixed(0)}% position). Bandwidth: ${(bandwidth * 100).toFixed(1)}%.`;
      }
      sigs.push({ name: 'Bollinger Bands', value: `${(pos * 100).toFixed(0)}%`, signal, explanation });
    }

    // 5. EMA 9/21 Cross
    if (indicators?.ema9 != null && indicators?.ema21 != null) {
      const e9 = indicators.ema9;
      const e21 = indicators.ema21;
      let signal: SignalDirection = 'NEUTRAL';
      let explanation = '';
      if (e9 > e21) {
        signal = 'BULLISH';
        explanation = `EMA 9 ($${e9.toFixed(0)}) is above EMA 21 ($${e21.toFixed(0)}), indicating short-term bullish trend.`;
      } else if (e9 < e21) {
        signal = 'BEARISH';
        explanation = `EMA 9 ($${e9.toFixed(0)}) is below EMA 21 ($${e21.toFixed(0)}), indicating short-term bearish trend.`;
      }
      sigs.push({ name: 'EMA 9/21 Cross', value: `${e9 > e21 ? 'Bullish' : 'Bearish'}`, signal, explanation });
    }

    // 6. Golden/Death Cross (SMA 50/200)
    if (indicators?.sma50 != null && indicators?.sma200 != null) {
      const s50 = indicators.sma50;
      const s200 = indicators.sma200;
      let signal: SignalDirection = 'NEUTRAL';
      let explanation = '';
      if (indicators.goldenCross) {
        signal = 'BULLISH';
        explanation = 'Golden Cross detected! SMA 50 just crossed above SMA 200, a strong bullish long-term signal.';
      } else if (indicators.deathCross) {
        signal = 'BEARISH';
        explanation = 'Death Cross detected! SMA 50 just crossed below SMA 200, a strong bearish long-term signal.';
      } else if (s50 > s200) {
        signal = 'BULLISH';
        explanation = `SMA 50 ($${s50.toFixed(0)}) is above SMA 200 ($${s200.toFixed(0)}), confirming long-term bullish trend.`;
      } else {
        signal = 'BEARISH';
        explanation = `SMA 50 ($${s50.toFixed(0)}) is below SMA 200 ($${s200.toFixed(0)}), indicating long-term bearish trend.`;
      }
      sigs.push({ name: 'SMA 50/200', value: indicators.goldenCross ? 'Golden Cross' : indicators.deathCross ? 'Death Cross' : s50 > s200 ? 'Bullish' : 'Bearish', signal, explanation });
    } else {
      sigs.push({ name: 'SMA 50/200', value: 'N/A', signal: 'NEUTRAL', explanation: 'Insufficient data for SMA 50/200 calculation (need 200+ candles).' });
    }

    // 7. Volume
    if (indicators?.currentVolume != null && indicators?.volumeAvg20 != null) {
      const cv = indicators.currentVolume;
      const avg = indicators.volumeAvg20;
      const ratio = avg > 0 ? cv / avg : 1;
      let signal: SignalDirection = 'NEUTRAL';
      let explanation = '';
      if (ratio >= (volumeSpikeMultiplier ?? 1.5)) {
        signal = currentPrice > 0 && indicators?.ema9 != null && currentPrice > indicators.ema9 ? 'BULLISH' : 'BEARISH';
        explanation = `Volume is ${ratio.toFixed(1)}x the 20-period average — a significant spike ${signal === 'BULLISH' ? 'confirming upward' : 'confirming downward'} momentum.`;
      } else if (ratio > 1) {
        explanation = `Volume is ${ratio.toFixed(1)}x average. Slightly above normal, watching for trend confirmation.`;
      } else {
        explanation = `Volume is ${ratio.toFixed(1)}x average. Below-average volume suggests low conviction in the current move.`;
      }
      sigs.push({ name: 'Volume Analysis', value: `${ratio.toFixed(1)}x avg`, signal, explanation, thresholds: `Spike > ${volumeSpikeMultiplier ?? 1.5}x avg` });
    }

    // 8. ATR
    if (indicators?.atr != null) {
      const atr = indicators.atr;
      const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
      let signal: SignalDirection = 'NEUTRAL';
      let explanation = `ATR at $${atr.toFixed(0)} (${atrPct.toFixed(2)}% of price). `;
      if (atrPct > 3) {
        explanation += 'Volatility is high — expect larger price swings. Good for short-term trades.';
      } else if (atrPct < 1.5) {
        explanation += 'Volatility is low — market is consolidating. A breakout may be imminent.';
      } else {
        explanation += 'Volatility is moderate.';
      }
      sigs.push({ name: 'ATR (14)', value: `$${atr.toFixed(0)}`, signal, explanation });
    }

    // 9. Support & Resistance
    const sr = indicators?.supportResistance ?? { supports: [], resistances: [] };
    const nearestResistance = sr.resistances?.[0] ?? null;
    const nearestSupport = sr.supports?.[0] ?? null;
    if (nearestResistance != null || nearestSupport != null) {
      let signal: SignalDirection = 'NEUTRAL';
      let explanation = '';
      if (nearestSupport != null && currentPrice > 0) {
        const distSupport = ((currentPrice - nearestSupport) / currentPrice) * 100;
        if (distSupport < 1) { signal = 'BULLISH'; explanation = `Price is near support at $${nearestSupport.toFixed(0)} (${distSupport.toFixed(1)}% away). Potential bounce zone.`; }
        else { explanation = `Nearest support at $${nearestSupport.toFixed(0)} (${distSupport.toFixed(1)}% below).`; }
      }
      if (nearestResistance != null && currentPrice > 0) {
        const distRes = ((nearestResistance - currentPrice) / currentPrice) * 100;
        if (distRes < 1) { signal = 'BEARISH'; explanation += ` Price approaching resistance at $${nearestResistance.toFixed(0)} (${distRes.toFixed(1)}% away).`; }
        else { explanation += ` Nearest resistance at $${nearestResistance.toFixed(0)} (${distRes.toFixed(1)}% above).`; }
      }
      sigs.push({ name: 'Support & Resistance', value: `S:$${nearestSupport?.toFixed?.(0) ?? 'N/A'} R:$${nearestResistance?.toFixed?.(0) ?? 'N/A'}`, signal, explanation: explanation.trim() });
    }

    // Calculate overall
    let totalScore = 0;
    let bullish = 0, bearish = 0, neutral = 0;
    for (const s of sigs) {
      totalScore += scoreMap[s.signal] ?? 0;
      if (s.signal === 'BULLISH') bullish++;
      else if (s.signal === 'BEARISH') bearish++;
      else neutral++;
    }

    const overall = getOverallSignal(totalScore, sigs.length);
    const confidence = sigs.length > 0 ? Math.min(Math.round((Math.abs(totalScore) / sigs.length) * 100), 100) : 0;

    // Projections
    let projections: PriceProjections | null = null;
    if (currentPrice > 0 && indicators?.atr != null) {
      const atr = indicators.atr;
      projections = {
        range24h: { low: currentPrice - atr, high: currentPrice + atr },
        scenario7d: {
          bull: currentPrice + atr * 3,
          base: currentPrice + (totalScore > 0 ? atr * 0.5 : -atr * 0.5),
          bear: currentPrice - atr * 3,
        },
        nextResistance: nearestResistance,
        nextSupport: nearestSupport,
      };
    }

    return {
      overall,
      confidence,
      bullishCount: bullish,
      bearishCount: bearish,
      neutralCount: neutral,
      indicators: sigs,
      entryPrice: nearestSupport,
      exitPrice: nearestResistance,
      projections,
    };
  }, [indicators, currentPrice, settings]);
};
