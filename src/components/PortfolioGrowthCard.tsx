import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Line, Polyline, Path, Text as SvgText } from 'react-native-svg';
import { GlassCard } from './GlassCard';
import { fetchOHLCV } from '../services/api';
import { portfolioHistory } from '../services/portfolioHistory';
import { summariseHoldings } from '../services/journal';
import { priceScale, formatAxisPrice, dateLabelIndexes, formatCandleTime } from '../services/chartWindow';
import { dropIncompleteCandle } from '../services/candles';
import { formatMoney } from '../services/format';
import { Colors, Typography, Spacing, Fonts } from '../constants/theme';
import type { LivePrices, OpeningPosition, Trade } from '../services/journal';
import type { OHLCVCandle } from '../types';

let gbpDaily: { at: number; candles: OHLCVCandle[] } | null = null;

/**
 * What your Bitcoin has been worth, day by day, against what it cost you.
 * In pounds, from Kraken's own BTC/GBP daily prices.
 */
export const PortfolioGrowthCard = ({ trades, opening, live }: { trades: Trade[]; opening: OpeningPosition | null; live: LivePrices }) => {
  const [daily, setDaily] = useState<OHLCVCandle[] | null>(gbpDaily?.candles ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (gbpDaily && Date.now() - gbpDaily.at < 30 * 60 * 1000) return;
    let cancelled = false;
    fetchOHLCV('1D', 'GBP')
      .then((c) => {
        if (cancelled) return;
        gbpDaily = { at: Date.now(), candles: c };
        setDaily(c);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const points = useMemo(() => {
    if (!daily?.length) return [];
    const closed = dropIncompleteCandle(daily, '1D');
    const pts = portfolioHistory(trades, opening, closed, 'GBP', live);
    // Today, at the live price, so the last point matches the Holdings card.
    if (pts.length && live.gbp > 0) {
      const now = summariseHoldings(trades, 'GBP', live, opening);
      pts.push({ day: pts[pts.length - 1]!.day + 86400000, btc: now.btc, value: now.value, paidIn: now.costBasis });
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, trades, opening, live.gbp, live.usd]);

  const width = Dimensions.get('window').width - 32 - 32;
  const AXIS = 46;
  const H = 150;
  const DATE_H = 16;
  const W = width - AXIS;

  if (failed && !daily) {
    return (
      <GlassCard>
        <Text style={styles.title}>Worth against what you paid</Text>
        <Text style={styles.body}>Daily pound prices did not load, so this chart cannot be drawn right now.</Text>
      </GlassCard>
    );
  }
  if (points.length < 2) {
    return (
      <GlassCard>
        <Text style={styles.title}>Worth against what you paid</Text>
        <Text style={styles.body}>
          {daily ? 'The chart fills in as the days pass after your starting balance or first trade.' : 'Loading daily prices…'}
        </Text>
      </GlassCard>
    );
  }

  const lo = Math.min(...points.map((p) => Math.min(p.value, p.paidIn)));
  const hi = Math.max(...points.map((p) => Math.max(p.value, p.paidIn)));
  const scale = priceScale(lo, hi, 3);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => 4 + ((scale.max - v) / (scale.max - scale.min)) * (H - 8);
  const valuePts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  // Paid in drawn as steps: it only changes when you buy or sell.
  const paidPath = points
    .map((p, i) => (i === 0 ? `M ${x(0).toFixed(1)} ${y(p.paidIn).toFixed(1)}` : `H ${x(i).toFixed(1)} V ${y(p.paidIn).toFixed(1)}`))
    .join(' ');
  const last = points[points.length - 1]!;
  const up = last.value >= last.paidIn;
  const diff = last.value - last.paidIn;

  return (
    <GlassCard>
      <Text style={styles.title}>Worth against what you paid</Text>
      <Text style={styles.body}>
        Now worth {formatMoney(last.value, 'GBP')}, against {formatMoney(last.paidIn, 'GBP')} paid:{' '}
        <Text style={{ color: up ? Colors.bullish : Colors.bearish, fontWeight: '700' }}>{formatMoney(diff, 'GBP', true)}</Text>.
      </Text>
      <Svg width={width} height={H + DATE_H}>
        {scale.ticks.map((t) => (
          <React.Fragment key={t}>
            <Line x1={0} x2={W} y1={y(t)} y2={y(t)} stroke={Colors.cardBorder} />
            <SvgText fontFamily={Fonts.system} x={W + 4} y={y(t) + 3.5} fill={Colors.textTertiary} fontSize={10}>
              {formatAxisPrice(t, scale.step, 'GBP')}
            </SvgText>
          </React.Fragment>
        ))}
        <Path d={paidPath} fill="none" stroke={Colors.textSecondary} strokeWidth={1.5} strokeDasharray="5 3" />
        <Polyline points={valuePts.join(' ')} fill="none" stroke={up ? Colors.bullish : Colors.bearish} strokeWidth={2} />
        {dateLabelIndexes(points.length, 3).map((i) => (
          <SvgText fontFamily={Fonts.system} key={i} x={x(i)} y={H + 12} fill={Colors.textTertiary} fontSize={10} textAnchor="middle">
            {formatCandleTime(points[i]!.day, '1D')}
          </SvgText>
        ))}
      </Svg>
      <View style={styles.legend}>
        <View style={[styles.swatch, { backgroundColor: up ? Colors.bullish : Colors.bearish }]} />
        <Text style={styles.legendText}>Worth</Text>
        <View style={[styles.swatch, { backgroundColor: Colors.textSecondary, height: 2 }]} />
        <Text style={styles.legendText}>Paid for what you hold</Text>
      </View>
      <Text style={styles.note}>
        Paid for what you hold drops after a sale by what the coins sold had cost. Pound prices from Kraken&apos;s daily close.
      </Text>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  title: { ...Typography.subheading, marginBottom: Spacing.xs },
  body: { ...Typography.caption, fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.sm },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  swatch: { width: 14, height: 3, borderRadius: 2 },
  legendText: { ...Typography.caption, color: Colors.textSecondary, marginRight: Spacing.sm },
  note: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, marginTop: Spacing.sm },
});
