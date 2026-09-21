import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { Colors, Typography, Spacing } from '../constants/theme';

interface Props {
  value: number;
  label: string;
  size?: number;
}

const getColor = (v: number): string => {
  if (v <= 25) return Colors.bearish;
  if (v <= 45) return '#FF6D00';
  if (v <= 55) return Colors.neutral;
  if (v <= 75) return '#66BB6A';
  return Colors.bullish;
};

export const FearGreedGauge = ({ value, label, size = 180 }: Props) => {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 16;
  const startAngle = Math.PI;
  const endAngle = 0;
  const clampedVal = Math.max(0, Math.min(100, value));
  const needleAngle = startAngle - (clampedVal / 100) * Math.PI;

  // Arc path
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy - r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy - r * Math.sin(endAngle);
  const arcPath = `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;

  // Colored arc up to value
  const valAngle = startAngle - (clampedVal / 100) * Math.PI;
  const xv = cx + r * Math.cos(valAngle);
  const yv = cy - r * Math.sin(valAngle);
  const largeArc = clampedVal > 50 ? 1 : 0;
  const valArcPath = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${xv} ${yv}`;

  // Needle tip
  const needleLen = r - 10;
  const nx = cx + needleLen * Math.cos(needleAngle);
  const ny = cy - needleLen * Math.sin(needleAngle);

  const color = getColor(clampedVal);

  return (
    <View style={styles.container}>
      <Svg width={size} height={size / 2 + 20} viewBox={`0 0 ${size} ${size / 2 + 20}`}>
        <Path d={arcPath} stroke={Colors.elevated} strokeWidth={12} fill="none" strokeLinecap="round" />
        <Path d={valArcPath} stroke={color} strokeWidth={12} fill="none" strokeLinecap="round" />
        <Circle cx={nx} cy={ny} r={5} fill={color} />
        <Circle cx={cx} cy={cy} r={3} fill={Colors.textSecondary} />
        <Path d={`M ${cx} ${cy} L ${nx} ${ny}`} stroke={Colors.textPrimary} strokeWidth={2} />
      </Svg>
      <Text style={[styles.value, { color }]}>{clampedVal}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  value: { ...Typography.display, marginTop: -20 },
  label: { ...Typography.caption, marginTop: 4 },
});
