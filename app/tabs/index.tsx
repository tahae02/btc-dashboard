import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../src/context/DataContext';
import { useSettings } from '../../src/context/SettingsContext';
import { useIndicators } from '../../src/hooks/useIndicators';
import { useSignalEngine } from '../../src/hooks/useSignalEngine';
import { GlassCard } from '../../src/components/GlassCard';
import { SignalBadge } from '../../src/components/SignalBadge';
import { FearGreedGauge } from '../../src/components/FearGreedGauge';
import { SkeletonLoader } from '../../src/components/SkeletonLoader';
import { ErrorRetry } from '../../src/components/ErrorRetry';
import { Colors, Typography, Spacing, BorderRadius, getSignalColor, Fonts } from '../../src/constants/theme';

const formatNum = (n: number | null | undefined, decimals = 0): string => {
  if (n == null || isNaN(n)) return '--';
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: decimals })}`;
};

const timeAgo = (date: Date | null): string => {
  if (!date) return '--';
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
};

export default function DashboardScreen() {
  const router = useRouter();
  const data = useData();
  const settings = useSettings();
  const candles = data?.ohlcv?.['1D'] ?? [];
  const indicators = useIndicators(candles);
  const signal = useSignalEngine({
    indicators,
    currentPrice: data?.price?.price ?? 0,
    settings,
  });

  const price = data?.price;
  const isUp = (price?.change_24h_pct ?? 0) >= 0;
  const fg = data?.fearGreed;

  const miniIndicators = useMemo(() => [
    { name: 'RSI', value: indicators?.rsi?.value?.toFixed?.(1) ?? '--', signal: signal?.indicators?.find?.(i => i?.name?.includes?.('RSI') && !i?.name?.includes?.('Stoch'))?.signal ?? 'NEUTRAL' },
    { name: 'MACD', value: indicators?.macd?.histogram?.toFixed?.(0) ?? '--', signal: signal?.indicators?.find?.(i => i?.name?.includes?.('MACD'))?.signal ?? 'NEUTRAL' },
    { name: 'StochRSI', value: indicators?.stochRSI?.k?.toFixed?.(1) ?? '--', signal: signal?.indicators?.find?.(i => i?.name?.includes?.('Stoch'))?.signal ?? 'NEUTRAL' },
    { name: 'BBands', value: signal?.indicators?.find?.(i => i?.name?.includes?.('Bollinger'))?.value ?? '--', signal: signal?.indicators?.find?.(i => i?.name?.includes?.('Bollinger'))?.signal ?? 'NEUTRAL' },
  ], [indicators, signal]);

  const priceDisplay = price?.price != null
    ? settings?.currency === 'GBP'
      ? `£${(price?.price_gbp ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : `$${price.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : '--';

  if (data?.isLoading && !price) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>BTC Analyst</Text>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <SkeletonLoader width="100%" height={140} />
          <SkeletonLoader width="100%" height={60} style={{ marginTop: Spacing.md }} />
          <View style={styles.statsGrid}>
            {[1, 2, 3, 4].map(i => <SkeletonLoader key={i} width="48%" height={80} />)}
          </View>
          <SkeletonLoader width="100%" height={120} style={{ marginTop: Spacing.md }} />
          <SkeletonLoader width="100%" height={140} style={{ marginTop: Spacing.md }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>BTC Analyst</Text>
        <View style={styles.headerRight}>
          <Text style={styles.timestamp}>{timeAgo(data?.lastUpdated)}</Text>
          <Pressable onPress={() => data?.refresh?.()} hitSlop={8}>
            <Ionicons name="refresh" size={20} color={Colors.accent} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={data?.isLoading ?? false} onRefresh={() => data?.refresh?.()} tintColor={Colors.accent} />}
      >
        {data?.error && <ErrorRetry message={data.error} onRetry={() => data?.refresh?.()} />}

        {/* Hero Price Card */}
        <GlassCard style={styles.heroCard}>
          <View style={styles.heroTop}>
            <Ionicons name="logo-bitcoin" size={24} color={Colors.neutral} />
            <Text style={styles.btcLabel}>Bitcoin</Text>
          </View>
          <Text style={styles.priceText}>{priceDisplay}</Text>
          <View style={styles.changeRow}>
            <Text style={[styles.changeText, { color: isUp ? Colors.bullish : Colors.bearish }]}>
              {isUp ? '▲' : '▼'} {formatNum(Math.abs(price?.change_24h ?? 0), 0)} ({(price?.change_24h_pct ?? 0).toFixed(2)}%)
            </Text>
          </View>
          <View style={styles.hlRow}>
            <Text style={styles.hlText}>24h High: {formatNum(price?.high_24h, 0)}</Text>
            <Text style={styles.hlText}>24h Low: {formatNum(price?.low_24h, 0)}</Text>
          </View>
        </GlassCard>

        {/* Signal Badge Card */}
        <Pressable onPress={() => router.push('/tabs/signals')}>
          <GlassCard style={styles.signalCard}>
            <View style={styles.signalRow}>
              <View>
                <SignalBadge signal={signal?.overall ?? 'NEUTRAL'} />
                <Text style={styles.signalConf}>Confidence: {signal?.confidence ?? 0}%</Text>
              </View>
              <Text style={styles.signalCounts}>
                {signal?.bullishCount ?? 0} Bullish · {signal?.bearishCount ?? 0} Bearish · {signal?.neutralCount ?? 0} Neutral
              </Text>
            </View>
            <View style={styles.confBar}>
              <View style={[styles.confFill, { width: `${signal?.confidence ?? 0}%`, backgroundColor: getSignalColor(signal?.overall ?? 'NEUTRAL') }]} />
            </View>
          </GlassCard>
        </Pressable>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          {[
            { label: 'Market Cap', value: formatNum(price?.market_cap) },
            { label: '24h Volume', value: formatNum(price?.volume_24h) },
            { label: 'BTC Dominance', value: data?.btcDominance != null ? `${data.btcDominance.toFixed(1)}%` : '--' },
            { label: 'ATR Volatility', value: indicators?.atr != null ? `$${indicators.atr.toFixed(0)}` : '--' },
          ].map((stat, i) => (
            <GlassCard key={i} style={styles.statCard}>
              <Text style={styles.statLabel}>{stat.label}</Text>
              <Text style={styles.statValue}>{stat.value}</Text>
            </GlassCard>
          ))}
        </View>

        {/* Mini Indicators */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {miniIndicators.map((ind, i) => (
            <Pressable key={i} onPress={() => router.push('/tabs/signals')}>
              <View style={styles.chip}>
                <View style={[styles.chipDot, { backgroundColor: getSignalColor(ind.signal) }]} />
                <Text style={styles.chipName}>{ind.name}</Text>
                <Text style={styles.chipValue}>{ind.value}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        {/* Fear & Greed */}
        {fg && (
          <GlassCard style={styles.gaugeCard}>
            <Text style={styles.sectionTitle}>Fear & Greed Index</Text>
            <FearGreedGauge
              value={fg?.current?.value ?? 50}
              label={fg?.current?.value_classification ?? 'Neutral'}
            />
          </GlassCard>
        )}

        {/* Price Projections */}
        {signal?.projections && (
          <GlassCard style={styles.projectionsCard}>
            <Text style={styles.sectionTitle}>Price Projections</Text>
            <View style={styles.projRow}>
              <Text style={styles.projLabel}>24h Range:</Text>
              <Text style={styles.projValue}>
                ${signal.projections.range24h.low.toLocaleString(undefined, { maximumFractionDigits: 0 })} – ${signal.projections.range24h.high.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </Text>
            </View>
            <View style={styles.scenarioRow}>
              {[
                { label: 'Bear', value: signal.projections.scenario7d.bear, color: Colors.bearish },
                { label: 'Base', value: signal.projections.scenario7d.base, color: Colors.neutral },
                { label: 'Bull', value: signal.projections.scenario7d.bull, color: Colors.bullish },
              ].map((s, i) => (
                <View key={i} style={styles.scenarioCol}>
                  <Text style={[styles.scenarioLabel, { color: s.color }]}>{s.label} 7d</Text>
                  <Text style={styles.scenarioValue}>${s.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                </View>
              ))}
            </View>
            {signal.projections.nextResistance != null && (
              <Text style={styles.projLevel}>↑ Resistance: ${signal.projections.nextResistance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            )}
            {signal.projections.nextSupport != null && (
              <Text style={styles.projLevel}>↓ Support: ${signal.projections.nextSupport.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            )}
          </GlassCard>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  headerTitle: { ...Typography.heading, color: Colors.textPrimary },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  timestamp: { ...Typography.caption, color: Colors.textTertiary },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.lg, gap: Spacing.md },
  heroCard: { alignItems: 'center' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btcLabel: { ...Typography.body, color: Colors.textSecondary },
  priceText: { ...Typography.priceDisplay, marginTop: 8 },
  changeRow: { marginTop: 4 },
  changeText: { ...Typography.monoData, fontSize: 16 },
  hlRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: Spacing.sm },
  hlText: { ...Typography.caption, color: Colors.textTertiary },
  signalCard: {},
  signalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  signalConf: { ...Typography.caption, marginTop: 4 },
  signalCounts: { ...Typography.caption, color: Colors.textSecondary, textAlign: 'right', maxWidth: '55%' },
  confBar: { height: 4, backgroundColor: Colors.elevated, borderRadius: 2, marginTop: Spacing.sm, overflow: 'hidden' },
  confFill: { height: '100%', borderRadius: 2 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, justifyContent: 'space-between' },
  statCard: { width: '47%', padding: Spacing.md },
  statLabel: { ...Typography.caption, color: Colors.textTertiary },
  statValue: { ...Typography.subheading, fontFamily: Fonts.mono, marginTop: 4 },
  chipRow: { flexGrow: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: BorderRadius.pill, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, borderWidth: 1, borderColor: Colors.cardBorder },
  chipDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  chipName: { ...Typography.caption, color: Colors.textSecondary, marginRight: 4 },
  chipValue: { ...Typography.monoData, fontSize: 12 },
  gaugeCard: { alignItems: 'center' },
  sectionTitle: { ...Typography.subheading, marginBottom: Spacing.md, alignSelf: 'flex-start' },
  projectionsCard: {},
  projRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.sm },
  projLabel: { ...Typography.body, color: Colors.textSecondary },
  projValue: { ...Typography.monoData },
  scenarioRow: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: Spacing.md },
  scenarioCol: { alignItems: 'center' },
  scenarioLabel: { ...Typography.caption, fontWeight: '600' },
  scenarioValue: { ...Typography.monoData, marginTop: 4 },
  projLevel: { ...Typography.monoData, color: Colors.textSecondary, marginTop: 4 },
});
