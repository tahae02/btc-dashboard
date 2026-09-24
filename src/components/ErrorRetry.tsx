import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';

interface Props {
  message?: string;
  onRetry?: () => void;
  /**
   * A one-line notice rather than a full block. For when the core data is
   * live and only an extra is missing: worth mentioning, not worth the top
   * third of the screen.
   */
  compact?: boolean;
}

export const ErrorRetry = ({ message, onRetry, compact }: Props) =>
  compact ? (
    <View style={styles.compact}>
      <Text style={styles.compactText}>{message ?? 'Some data is unavailable'}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
          <Text style={styles.compactRetry}>Retry</Text>
        </Pressable>
      )}
    </View>
  ) : (
  <View style={styles.container}>
    <Text style={styles.text}>{message ?? 'Unable to fetch data'}</Text>
    {onRetry && (
      <Pressable style={styles.btn} onPress={onRetry}>
        <Text style={styles.btnText}>Retry</Text>
      </Pressable>
    )}
  </View>
  );

const styles = StyleSheet.create({
  container: { padding: Spacing.xl, alignItems: 'center' },
  text: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center' },
  btn: { marginTop: Spacing.md, backgroundColor: Colors.accent, paddingHorizontal: 20, paddingVertical: 10, borderRadius: BorderRadius.sm },
  btnText: { ...Typography.body, color: '#000', fontWeight: '600' },
  compact: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, marginBottom: Spacing.md,
    borderRadius: BorderRadius.sm, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  compactText: { ...Typography.caption, flex: 1 },
  compactRetry: { ...Typography.caption, color: Colors.accent, fontWeight: '600' },
});
