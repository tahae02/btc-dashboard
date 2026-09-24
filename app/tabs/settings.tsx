import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SegmentedButtons } from 'react-native-paper';
import { useSettings } from '../../src/context/SettingsContext';
import { GlassCard } from '../../src/components/GlassCard';
import { MIN_RSI_GAP } from '../../src/services/settings';
import { Colors, Typography, Spacing, BorderRadius } from '../../src/constants/theme';
import type { RefreshInterval, Currency, Timeframe } from '../../src/types';

export default function SettingsScreen() {
  const settings = useSettings();

  const [rsiOBStr, setRsiOBStr] = useState(String(settings?.rsiOverbought ?? 70));
  const [rsiOSStr, setRsiOSStr] = useState(String(settings?.rsiOversold ?? 30));

  // The pair is validated together, so the warning is derived from what is
  // currently typed rather than from either field alone.
  const obNum = parseFloat(rsiOBStr);
  const osNum = parseFloat(rsiOSStr);
  const rsiPairInvalid =
    Number.isFinite(obNum) && Number.isFinite(osNum) && osNum >= obNum - MIN_RSI_GAP;

  const commitRsi = () => {
    // Writing both at once lets the context validate them as a pair. Writing
    // them one at a time is what previously allowed an inverted band through.
    if (Number.isFinite(osNum)) settings?.setRsiOversold?.(osNum);
    if (Number.isFinite(obNum)) settings?.setRsiOverbought?.(obNum);
  };

  const refreshLabel =
    settings?.refreshInterval === 'manual' ? 'Manual refresh only'
    : settings?.refreshInterval === '1min' ? 'Auto-refreshing every 1 min'
    : 'Auto-refreshing every 5 min';

  const stretchLabel =
    settings.stretchWeight === 0 ? 'Off — the regime alone decides the allocation'
    : settings.stretchWeight <= 0.15 ? 'Light — small tilts on stretched prices'
    : settings.stretchWeight <= 0.3 ? 'Moderate — noticeably more trading'
    : 'Heavy — frequent trading, and fees start to bite';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.screenTitle}>Settings</Text>

        <Text style={styles.sectionHeader}>Signal</Text>
        <GlassCard>
          <Text style={styles.label}>Signal timeframe</Text>
          <SegmentedButtons
            value={settings?.signalTimeframe ?? '1D'}
            onValueChange={(v) => settings?.setSignalTimeframe?.(v as Timeframe)}
            buttons={(['1H', '4H', '1D', '1W'] as Timeframe[]).map((tf) => ({ value: tf, label: tf, style: styles.segBtn }))}
            style={styles.segmented}
          />
          <Text style={styles.sublabel}>
            Which candles the regime and allocation are computed on. Longer timeframes trade
            less and react more slowly. This is what the Dashboard and Signals screens use;
            the Chart screen can be viewed at any timeframe independently.
          </Text>
        </GlassCard>

        <GlassCard>
          <Text style={styles.label}>Mean-reversion strength</Text>
          <SegmentedButtons
            value={String(settings.stretchWeight)}
            onValueChange={(v) => settings?.setStretchWeight?.(parseFloat(v))}
            buttons={[
              { value: '0', label: 'Off', style: styles.segBtn },
              { value: '0.15', label: 'Light', style: styles.segBtn },
              { value: '0.3', label: 'Moderate', style: styles.segBtn },
              { value: '0.5', label: 'Heavy', style: styles.segBtn },
            ]}
            style={styles.segmented}
          />
          <Text style={styles.sublabel}>{stretchLabel}</Text>
          <Text style={styles.note}>
            How far an overbought or oversold reading may move the allocation away from what
            the regime says. It can never flip the call, only temper it. Backtesting on the
            bundled data favoured "Light": heavier settings traded several times more often
            and gave most of the gain back in fees. Run `yarn backtest --sweep` on your own
            data before changing it.
          </Text>
        </GlassCard>

        <Text style={styles.sectionHeader}>Data Refresh</Text>
        <GlassCard>
          <Text style={styles.label}>Refresh interval</Text>
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

        <Text style={styles.sectionHeader}>Display</Text>
        <GlassCard>
          <Text style={styles.label}>Price currency</Text>
          <SegmentedButtons
            value={settings?.currency ?? 'USD'}
            onValueChange={(v) => settings?.setCurrency?.(v as Currency)}
            buttons={[
              { value: 'USD', label: 'USD', style: styles.segBtn },
              { value: 'GBP', label: 'GBP', style: styles.segBtn },
            ]}
            style={styles.segmented}
          />
          <Text style={styles.sublabel}>
            Affects the headline price only. Charts and indicators stay in USD, which is where
            the liquidity is.
          </Text>
        </GlassCard>

        <Text style={styles.sectionHeader}>RSI Display Bands</Text>
        <GlassCard>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Oversold below</Text>
            <TextInput
              style={[styles.input, rsiPairInvalid && styles.inputInvalid]}
              value={rsiOSStr}
              onChangeText={setRsiOSStr}
              onBlur={commitRsi}
              onSubmitEditing={commitRsi}
              keyboardType="numeric"
              placeholderTextColor={Colors.textTertiary}
              accessibilityLabel="RSI oversold threshold"
            />
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Overbought above</Text>
            <TextInput
              style={[styles.input, rsiPairInvalid && styles.inputInvalid]}
              value={rsiOBStr}
              onChangeText={setRsiOBStr}
              onBlur={commitRsi}
              onSubmitEditing={commitRsi}
              keyboardType="numeric"
              placeholderTextColor={Colors.textTertiary}
              accessibilityLabel="RSI overbought threshold"
            />
          </View>
          {rsiPairInvalid && (
            <Text style={styles.warning}>
              Oversold must be at least {MIN_RSI_GAP} below overbought. These values will be
              reset to 30 / 70 when saved.
            </Text>
          )}
          <Text style={styles.note}>
            These label the RSI reading on the Signals screen. They do not drive the
            allocation — that comes from the regime and the mean-reversion strength above.
          </Text>
        </GlassCard>

        <GlassCard>
          <Pressable onPress={() => {
            settings?.resetDefaults?.();
            setRsiOSStr('30');
            setRsiOBStr('70');
          }}>
            <Text style={styles.resetText}>Reset all settings to defaults</Text>
          </Pressable>
        </GlassCard>

        <Text style={styles.sectionHeader}>About</Text>
        <GlassCard>
          <Text style={styles.aboutText}>BTC Analyst v2.0.0</Text>
          <Text style={styles.aboutSub}>
            Data sources: Kraken (price &amp; candles) · CoinPaprika (dominance) ·
            Alternative.me (Fear &amp; Greed) · mempool.space (on-chain, native builds only)
          </Text>
          <Text style={styles.aboutSub}>
            All indicators are computed on-device from public price data. No accounts, no API
            keys, nothing sent anywhere.
          </Text>
          <Text style={styles.disclaimer}>
            Not financial advice. This app applies fixed rules to past prices; it has no
            knowledge of the future and no way to react to news. Bitcoin has repeatedly fallen
            more than 70% from its peak. Never invest money you cannot afford to lose, and do
            your own research.
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
  sectionHeader: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '700', marginTop: Spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { ...Typography.body, fontWeight: '600', marginBottom: Spacing.sm },
  sublabel: { ...Typography.caption, color: Colors.textSecondary, marginTop: Spacing.sm, lineHeight: 17 },
  note: { ...Typography.caption, color: Colors.textTertiary, marginTop: Spacing.sm, lineHeight: 17 },
  warning: { ...Typography.caption, color: Colors.bearish, marginTop: Spacing.sm, lineHeight: 17 },
  segmented: { marginTop: 4 },
  segBtn: { borderColor: Colors.cardBorder },
  inputRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  inputLabel: { ...Typography.body, color: Colors.textSecondary },
  input: {
    ...Typography.monoData, backgroundColor: Colors.elevated, borderRadius: BorderRadius.sm,
    borderWidth: 1, borderColor: Colors.cardBorder, paddingHorizontal: 12, paddingVertical: 8,
    minWidth: 80, textAlign: 'right', color: Colors.textPrimary,
  },
  inputInvalid: { borderColor: Colors.bearish },
  resetText: { ...Typography.body, color: Colors.accent, textAlign: 'center' },
  aboutText: { ...Typography.body, fontWeight: '600' },
  aboutSub: { ...Typography.caption, color: Colors.textSecondary, marginTop: Spacing.sm, lineHeight: 17 },
  disclaimer: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 18, marginTop: Spacing.md },
});
