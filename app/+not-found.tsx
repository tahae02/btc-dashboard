import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Typography } from '../src/constants/theme';

export default function NotFound() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>404</Text>
      <Text style={styles.subtitle}>Page not found</Text>
      <Pressable style={styles.btn} onPress={() => router.replace('/tabs')}>
        <Text style={styles.btnText}>Go to Dashboard</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center' },
  title: { ...Typography.display, fontSize: 48 },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: 8 },
  btn: { marginTop: 24, backgroundColor: Colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  btnText: { ...Typography.body, color: '#000', fontWeight: '600' },
});
