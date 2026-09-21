import React, { type ReactNode } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, BorderRadius, Spacing } from '../constants/theme';

interface Props {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const GlassCard = ({ children, style }: Props) => (
  <View style={[styles.card, style]}>{children}</View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glassBackground,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.lg,
  },
});
