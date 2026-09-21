import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';

interface Props {
  message?: string;
  onRetry?: () => void;
}

export const ErrorRetry = ({ message, onRetry }: Props) => (
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
});
