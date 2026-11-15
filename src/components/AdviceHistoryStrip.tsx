import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Rect, Polyline, Text as SvgText } from 'react-native-svg';
import { GlassCard } from './GlassCard';
import { InfoButton } from './InfoButton';
import { adviceRuns, TIERS, type DayCall } from '../services/trackRecord';
import { ACTION_LABEL } from '../services/signalEngine';
import { Colors, Typography, Spacing, Fonts, getSignalColor } from '../constants/theme';
import type { OHLCVCandle } from '../types';

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A year of the app's advice as colour bands, with the BTC/USD price drawn
 * over them, so you can see when it said buy more, hold or reduce, and what
 * the price did around each. Replayed from history: each day sees only the
 * prices up to that day.
 */
export const AdviceHistoryStrip = ({ calls, daily }: { calls: DayCall[] | null; daily: OHLCVCandle[] }) => {
  const width = Dimensions.get('window').width - 32 - 32;
  const H = 110;
  const DATE_H = 16;

  const view = useMemo(() => {
    if (!calls?.length) return null;
    const end = calls[calls.length - 1]!.day;
    const start = end - 364 * DAY;
    const runs = adviceRuns(calls, start);
    const closes = daily.filter((c) => c.time >= start && c.time <= end && c.close > 0);
    if (!runs.length || closes.length < 2) return null;
    const lo = Math.min(...closes.map((c) => c.close));
    const hi = Math.max(...closes.map((c) => c.close));
    const x = (t: number) => ((t - start) / (end + DAY - start)) * width;
    const y = (p: number) => 8 + (1 - (p - lo) / Math.max(1, hi - lo)) * (H - 16);
    // Month labels on the first of each month, every other one on a narrow screen.
    const ticks: { t: number; label: string }[] = [];
    const d = new Date(start);
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    for (let k = 0; d.getTime() <= end; k++, d.setMonth(d.getMonth() + 1)) {
      if (k % 2 === 0) ticks.push({ t: d.getTime(), label: MONTHS[d.getMonth()]! });
    }
    const used = TIERS.filter((a) => runs.some((r) => r.action === a));
    const share = Object.fromEntries(used.map((a) => [a, runs.filter((r) => r.action === a).reduce((n, r) => n + r.days, 0)]));
    const total = runs.reduce((n, r) => n + r.days, 0);
    return { runs, closes, x, y, ticks, used, share, total };
  }, [calls, daily, width]);

  return (
    <GlassCard>
      <View style={styles.titleRow}>
        <Text style={styles.title}>The advice over the last year</Text>
        <InfoButton term="action" />
      </View>
      {!view ? (
        <Text style={styles.body}>Appears once the past year has been replayed (see Track record below).</Text>
      ) : (
        <>
          <Text style={styles.body}>
            Each colour is what the app would have said that day, seeing only prices up to then. The line is the
            Bitcoin price.
          </Text>
          <Svg width={width} height={H + DATE_H}>
            {view.runs.map((r) => (
              <Rect
                key={r.from}
                x={view.x(r.from)}
                y={0}
                width={Math.max(1, view.x(r.to + DAY) - view.x(r.from))}
                height={H}
                fill={getSignalColor(r.action)}
                fillOpacity={0.28}
              />
            ))}
            <Polyline
              points={view.closes.map((c) => `${view.x(c.time + DAY / 2).toFixed(1)},${view.y(c.close).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={Colors.textPrimary}
              strokeWidth={1.5}
            />
            {view.ticks.map((t) => (
              <SvgText fontFamily={Fonts.system} key={t.t} x={view.x(t.t)} y={H + 12} fill={Colors.textTertiary} fontSize={10} textAnchor="middle">
                {t.label}
              </SvgText>
            ))}
          </Svg>
          <View style={styles.legend}>
            {view.used.map((a) => (
              <View key={a} style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: getSignalColor(a) }]} />
                <Text style={styles.legendText}>
                  {ACTION_LABEL[a]} {Math.round(((view.share[a] ?? 0) / view.total) * 100)}%
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.sm },
  title: { ...Typography.subheading },
  body: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18, marginBottom: Spacing.sm },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { ...Typography.caption, color: Colors.textSecondary },
});
