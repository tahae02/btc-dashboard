import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from './GlassCard';
import { useData } from '../context/DataContext';
import { useJournal } from '../context/JournalContext';
import { detectConditions, adviceChangeFrom, change7d } from '../services/paper';
import { Colors, Typography, Spacing } from '../constants/theme';

const DISMISS_KEY = 'btc_dashboard_home_alert_dismissed_v1';

/**
 * "Worth a look today": the advice changed, Bitcoin moved 5% in a day or 10%
 * in a week, or Fear & Greed is at 20 or below or 80 or above. The same
 * conditions the paper guide calls a reason for an extra paper decision.
 * Shown in the app because push alerts would need a new native module.
 * Dismissed until the conditions change.
 */
export const HomeAlertCard = () => {
  const router = useRouter();
  const data = useData();
  const journal = useJournal();
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(DISMISS_KEY).then(setDismissed).catch(() => {});
  }, []);

  const now = Date.now();
  const live = data.price?.price ?? null;
  const conditions = useMemo(
    () =>
      detectConditions({
        change24hPct: data.price ? data.price.change_24h_pct : null,
        change7dPct: change7d(journal.closedDaily, live, now),
        fearGreed: data.fearGreed?.current?.value ?? null,
        adviceChange: adviceChangeFrom(journal.signalLog, now),
      }),
    // Recomputed when the inputs change, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.price?.change_24h_pct, live, data.fearGreed?.current?.value, journal.signalLog, journal.closedDaily]
  );

  const id = `${new Date(now).toDateString()}|${conditions.scenarios.join(',')}`;
  if (!conditions.notes.length || dismissed === id) return null;

  const dismiss = () => {
    setDismissed(id);
    AsyncStorage.setItem(DISMISS_KEY, id).catch(() => {});
  };

  return (
    <GlassCard style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="notifications-outline" size={18} color={Colors.neutral} />
        <Text style={styles.title}>Worth a look today</Text>
        <Pressable onPress={dismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide until something changes">
          <Ionicons name="close" size={18} color={Colors.textSecondary} />
        </Pressable>
      </View>
      {conditions.notes.map((n) => (
        <Text key={n} style={styles.note}>• {n}</Text>
      ))}
      <Pressable onPress={() => router.push('/tabs/portfolio')} accessibilityRole="button">
        <Text style={styles.link}>A day for an extra paper decision. Open Portfolio →</Text>
      </Pressable>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  card: { borderColor: Colors.neutral + '66', borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Spacing.xs },
  title: { ...Typography.body, fontWeight: '700', flex: 1 },
  note: { ...Typography.caption, fontSize: 14, color: Colors.textPrimary, lineHeight: 20, marginTop: 2 },
  link: { ...Typography.caption, color: Colors.accent, fontWeight: '600', marginTop: Spacing.sm },
});
