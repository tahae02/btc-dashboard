import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { GlassCard } from './GlassCard';
import { avgPaidSeries, type AvgPaidPoint } from '../services/paperReview';
import { priceScale, formatAxisPrice, formatCandleTime } from '../services/chartWindow';
import { formatMoney } from '../services/format';
import { Colors, Typography, Spacing, Fonts } from '../constants/theme';
import type { LivePrices, Trade } from '../services/journal';

/**
 * Your real average price per BTC against the paper one, since paper trading
 * began, as two lines. Lower is better: it means each pound bought more.
 */
export const RealVsPaperChart = ({ real, paper, since, live }: { real: Trade[]; paper: Trade[]; since: number; live: LivePrices }) => {
  const width = Dimensions.get('window').width - 32 - 32;
  const AXIS = 46;
  const H = 120;
  const W = width - AXIS;
  const lines = useMemo(() => ({ real: avgPaidSeries(real, since, live), paper: avgPaidSeries(paper, since, live) }), [real, paper, since, live]);
  if (!lines.real.length || !lines.paper.length) return null;

  const all = [...lines.real, ...lines.paper];
  const t0 = since;
  const t1 = Math.max(Date.now(), ...all.map((p) => p.time));
  const scale = priceScale(Math.min(...all.map((p) => p.avgPrice)), Math.max(...all.map((p) => p.avgPrice)), 3);
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => 4 + ((scale.max - v) / (scale.max - scale.min)) * (H - 8);
  // Steps: the average only changes when there is a buy; carried on to today.
  const path = (pts: AvgPaidPoint[]) =>
    pts.map((p, i) => (i === 0 ? `M ${x(p.time).toFixed(1)} ${y(p.avgPrice).toFixed(1)}` : `H ${x(p.time).toFixed(1)} V ${y(p.avgPrice).toFixed(1)}`)).join(' ') +
    ` H ${W.toFixed(1)}`;
  const r = lines.real[lines.real.length - 1]!.avgPrice;
  const p = lines.paper[lines.paper.length - 1]!.avgPrice;

  return (
    <GlassCard>
      <Text style={styles.title}>Average price paid: real against paper</Text>
      <Text style={styles.body}>
        Real {formatMoney(r, 'GBP')}, paper {formatMoney(p, 'GBP')} per BTC.{' '}
        {Math.abs(r - p) / p < 0.001 ? 'About the same.' : r < p ? 'Your real buys paid less.' : 'The paper buys paid less.'}
      </Text>
      <Svg width={width} height={H + 16}>
        {scale.ticks.map((t) => (
          <React.Fragment key={t}>
            <Line x1={0} x2={W} y1={y(t)} y2={y(t)} stroke={Colors.cardBorder} />
            <SvgText fontFamily={Fonts.system} x={W + 4} y={y(t) + 3.5} fill={Colors.textTertiary} fontSize={10}>
              {formatAxisPrice(t, scale.step, 'GBP')}
            </SvgText>
          </React.Fragment>
        ))}
        <Path d={path(lines.real)} fill="none" stroke={Colors.accent} strokeWidth={2} />
        <Path d={path(lines.paper)} fill="none" stroke={Colors.paper} strokeWidth={2} strokeDasharray="5 3" />
        <SvgText fontFamily={Fonts.system} x={0} y={H + 12} fill={Colors.textTertiary} fontSize={10}>{formatCandleTime(t0, '1D')}</SvgText>
        <SvgText fontFamily={Fonts.system} x={W} y={H + 12} fill={Colors.textTertiary} fontSize={10} textAnchor="end">Today</SvgText>
      </Svg>
      <View style={styles.legend}>
        <View style={[styles.swatch, { backgroundColor: Colors.accent }]} />
        <Text style={styles.legendText}>Real</Text>
        <View style={[styles.swatch, { backgroundColor: Colors.paper }]} />
        <Text style={styles.legendText}>Paper</Text>
        <Text style={styles.legendText}>Lower is better</Text>
      </View>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  title: { ...Typography.subheading, marginBottom: Spacing.xs },
  body: { ...Typography.caption, fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.sm },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  swatch: { width: 14, height: 3, borderRadius: 2 },
  legendText: { ...Typography.caption, color: Colors.textSecondary, marginRight: Spacing.sm },
});
