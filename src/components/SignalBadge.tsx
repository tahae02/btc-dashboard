import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { SignalDirection } from '../types';
import { getSignalColor, Typography, BorderRadius } from '../constants/theme';

interface Props {
  signal: string | SignalDirection;
  compact?: boolean;
}

export const SignalBadge = ({ signal, compact }: Props) => {
  const color = getSignalColor(signal);
  return (
    <View style={[styles.badge, { backgroundColor: color + '33' }, compact && styles.compact]}>
      <Text style={[styles.text, { color }, compact && styles.compactText]}>{signal}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: { borderRadius: BorderRadius.sm, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  text: { ...Typography.caption, fontWeight: '700', fontSize: 13 },
  compact: { paddingHorizontal: 6, paddingVertical: 2 },
  compactText: { fontSize: 10 },
});
