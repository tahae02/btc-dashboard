import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SegmentedButtons } from 'react-native-paper';
import { useSettings } from '../../src/context/SettingsContext';
import { GlassCard } from '../../src/components/GlassCard';
import { Colors, Typography, Spacing, BorderRadius, Fonts } from '../../src/constants/theme';
import { RefreshInterval, Currency } from '../../src/types';

export default function SettingsScreen() {
  const settings = useSettings();

  const [rsiOBStr, setRsiOBStr] = useState(String(settings?.rsiOverbought ?? 70));
  const [rsiOSStr, setRsiOSStr] = useState(String(settings?.rsiOversold ?? 30));
  const [volStr, setVolStr] = useState(String(settings?.volumeSpikeMultiplier ?? 1.5));

  const handleRsiOB = (text: string) => {
    setRsiOBStr(text);
    const n = parseFloat(text);
    if (!isNaN(n) && n > 0 && n <= 100) settings?.setRsiOverbought?.(n);
  };

  const handleRsiOS = (text: string) => {
    setRsiOSStr(text);
    const n = parseFloat(text);
    if (!isNaN(n) && n >= 0 && n < 100) settings?.setRsiOversold?.(n);
  };

  const handleVol = (text: string) => {
    setVolStr(text);
    const n = parseFloat(text);
    if (!isNaN(n) && n > 0 && n <= 10) settings?.setVolumeSpikeMultiplier?.(n);
  };

  const refreshLabel = settings?.refreshInterval === 'manual' ? 'Manual refresh only'
    : settings?.refreshInterval === '1min' ? 'Auto-refreshing every 1 min'
    : 'Auto-refreshing every 5 min';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.screenTitle}>Settings</Text>

        {/* Data Refresh */}
        <Text style={styles.sectionHeader}>Data Refresh</Text>
        <GlassCard>
          <Text style={styles.label}>Refresh Interval</Text>
          <SegmentedButtons
            value={settings?.refreshInterval ?? '5min'}
            onValueChange={(v) => settings?.setRefreshInterval?.(v as RefreshInterval)}
            buttons={[
              { value: 'manual', label: 'Manual', style: styles.segBtn },
              { value: '1min', label: '1 min', style: styles.segBtn },
              { value: '5min', label: '5 min', style: styles.segBtn },
            ]}
            style={styles.segmented}
          />
          <Text style={styles.sublabel}>{refreshLabel}</Text>
        </GlassCard>

        {/* Display */}
        <Text style={styles.sectionHeader}>Display</Text>
        <GlassCard>
          <Text style={styles.label}>Price Currency</Text>
          <SegmentedButtons
            value={settings?.currency ?? 'USD'}
            onValueChange={(v) => settings?.setCurrency?.(v as Currency)}
            buttons={[
              { value: 'USD', label: 'USD', style: styles.segBtn },
              { value: 'GBP', label: 'GBP', style: styles.segBtn },
            ]}
            style={styles.segmented}
          />
        </GlassCard>

        {/* Alert Thresholds */}
        <Text style={styles.sectionHeader}>Alert Thresholds</Text>
        <GlassCard>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>RSI Overbought</Text>
            <TextInput
              style={styles.input}
              value={rsiOBStr}
              onChangeText={handleRsiOB}
              keyboardType="numeric"
              placeholderTextColor={Colors.textTertiary}
              accessibilityLabel="RSI overbought threshold"
            />
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>RSI Oversold</Text>
            <TextInput
              style={styles.input}
              value={rsiOSStr}
              onChangeText={handleRsiOS}
              keyboardType="numeric"
              placeholderTextColor={Colors.textTertiary}
              accessibilityLabel="RSI oversold threshold"
            />
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Volume Spike (x avg)</Text>
            <TextInput
              style={styles.input}
              value={volStr}
              onChangeText={handleVol}
              keyboardType="numeric"
              placeholderTextColor={Colors.textTertiary}
              accessibilityLabel="Volume spike multiplier"
            />
          </View>
        </GlassCard>

        {/* About */}
        <Text style={styles.sectionHeader}>About</Text>
        <GlassCard>
          <Text style={styles.aboutText}>BTC Analyst v1.0.0</Text>
          <Text style={styles.aboutSub}>Data sources: CoinGecko · Alternative.me · Mempool.space</Text>
          <Text style={styles.disclaimer}>
            This app is for informational purposes only. Not financial advice. Always do your own research before making investment decisions.
          </Text>
        </GlassCard>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.md },
  screenTitle: { ...Typography.heading },
  sectionHeader: { ...Typography.subheading, color: Colors.textSecondary, marginTop: Spacing.sm },
  label: { ...Typography.body, color: Colors.textSecondary, marginBottom: Spacing.sm },
  sublabel: { ...Typography.caption, color: Colors.textTertiary, marginTop: Spacing.sm },
  segmented: { marginBottom: 0 },
  segBtn: { borderColor: Colors.cardBorder },
  inputRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  inputLabel: { ...Typography.body, color: Colors.textSecondary, flex: 1 },
  input: {
    backgroundColor: Colors.elevated,
    color: Colors.textPrimary,
    fontFamily: Fonts.mono,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    width: 80,
    textAlign: 'center',
  },
  aboutText: { ...Typography.body, marginBottom: 4 },
  aboutSub: { ...Typography.caption, color: Colors.textSecondary, marginBottom: Spacing.md },
  disclaimer: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 18 },
});
