import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { Colors, Typography } from '../constants/theme';
import { FEAR_GREED_ZONES, fearGreedColor, gaugeArc, gaugePoint } from '../services/gauge';

interface Props {
  value: number;
  label: string;
  size?: number;
}

/**
 * Half-circle dial: the five zones drawn faintly, the reading in full colour
 * from the left up to the needle. See src/services/gauge.ts for the arc maths.
 */
export const FearGreedGauge = ({ value, label, size = 180 }: Props) => {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 16;
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = fearGreedColor(v);
  const valueArc = gaugeArc(cx, cy, r, 0, v);
  const tip = gaugePoint(cx, cy, r - 10, v);

  return (
    <View style={styles.container} accessibilityLabel={`Fear and Greed ${v} out of 100, ${label}`}>
      <Svg width={size} height={size / 2 + 20} viewBox={`0 0 ${size} ${size / 2 + 20}`}>
        {FEAR_GREED_ZONES.map((z) => {
          const d = gaugeArc(cx, cy, r, z.from, z.to);
          return d ? <Path key={z.label} d={d} stroke={z.color} strokeOpacity={0.18} strokeWidth={12} fill="none" /> : null;
        })}
        {valueArc && <Path d={valueArc} stroke={color} strokeWidth={12} fill="none" strokeLinecap="round" />}
        <Path d={`M ${cx} ${cy} L ${tip.x} ${tip.y}`} stroke={Colors.textPrimary} strokeWidth={2} />
        <Circle cx={tip.x} cy={tip.y} r={5} fill={color} />
        <Circle cx={cx} cy={cy} r={3} fill={Colors.textSecondary} />
      </Svg>
      <Text style={[styles.value, { color }]}>{v}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  value: { ...Typography.display, marginTop: -20 },
  label: { ...Typography.caption, marginTop: 4 },
});
