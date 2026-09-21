import React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useData } from '../../src/context/DataContext';
import { useSettings } from '../../src/context/SettingsContext';
import { GlassCard } from '../../src/components/GlassCard';
import { FearGreedGauge } from '../../src/components/FearGreedGauge';
import { SkeletonLoader } from '../../src/components/SkeletonLoader';
import { Colors, Typography, Spacing, Fonts } from '../../src/constants/theme';
import { IS_WEB } from '../../src/services/api';

const formatHashRate = (h: number): string => {
  if (!h) return '--';
  if (h >= 1e18) return `${(h / 1e18).toFixed(0)} EH/s`;
  if (h >= 1e15) return `${(h / 1e15).toFixed(0)} PH/s`;
  if (h >= 1e12) return `${(h / 1e12).toFixed(0)} TH/s`;
  return `${h.toFixed(0)} H/s`;
};

const getCongestion = (count: number): { label: string; color: string } => {
  if (count < 10000) return { label: 'Low', color: Colors.bullish };
  if (count < 50000) return { label: 'Medium', color: Colors.neutral };
  return { label: 'High', color: Colors.bearish };
};

export default function OnChainScreen() {
  const data = useData();
  const settings = useSettings();
  const fg = data?.fearGreed;
  const oc = data?.onChain;
  const price = data?.price;

  const fgHistory = fg?.history ?? [];
  const yesterday = fgHistory?.[1];
  const lastWeek = fgHistory?.[7];
  const lastMonth = fgHistory?.[30] ?? fgHistory?.[fgHistory.length - 1];

  const congestion = getCongestion(oc?.mempool?.count ?? 0);

  if (data?.isLoading && !price) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <SkeletonLoader width="100%" height={200} />
          {[1, 2, 3, 4].map(i => <SkeletonLoader key={i} width="100%" height={80} style={{ marginTop: Spacing.md }} />)}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={data?.isLoading ?? false} onRefresh={() => data?.refresh?.()} tintColor={Colors.accent} />}
      >
        {/* Fear & Greed Deep Dive */}
        <Text style={styles.sectionHeader}>Fear & Greed Deep Dive</Text>
        {fg && (
          <GlassCard style={styles.gaugeCard}>
            <FearGreedGauge value={fg?.current?.value ?? 50} label={fg?.current?.value_classification ?? 'Neutral'} size={220} />
            <View style={styles.fgHistoryRow}>
              {[
                { label: 'Yesterday', entry: yesterday },
                { label: 'Last Week', entry: lastWeek },
                { label: 'Last Month', entry: lastMonth },
              ].map((item, i) => (
                <View key={i} style={styles.fgHistoryCol}>
                  <Text style={styles.fgHistLabel}>{item.label}</Text>
                  <Text style={styles.fgHistValue}>{item?.entry?.value ?? '--'}</Text>
                  <Text style={styles.fgHistClass}>{item?.entry?.value_classification ?? '--'}</Text>
                </View>
              ))}
            </View>
          </GlassCard>
        )}

        {/* Fear & Greed 30d mini chart */}
        {fgHistory.length > 1 && (
          <GlassCard style={styles.fgChartCard}>
            <Text style={styles.cardTitle}>30-Day Fear & Greed</Text>
            <View style={styles.fgChart}>
              {fgHistory.slice(0, 30).reverse().map((entry, i, arr) => {
                const v = entry?.value ?? 50;
                const color = v <= 25 ? Colors.bearish : v <= 45 ? '#FF6D00' : v <= 55 ? Colors.neutral : v <= 75 ? '#66BB6A' : Colors.bullish;
                return (
                  <View key={i} style={{ flex: 1, justifyContent: 'flex-end', height: 60 }}>
                    <View style={{ height: `${v}%`, backgroundColor: color, borderRadius: 1, marginHorizontal: 0.5 }} />
                  </View>
                );
              })}
            </View>
          </GlassCard>
        )}

        {/* Network Stats */}
        <Text style={styles.sectionHeader}>Network Stats</Text>
        {IS_WEB && (
          <GlassCard style={styles.webNotice}>
            <Text style={styles.webNoticeText}>
              Live on-chain network metrics (hash rate, mempool, fees) load in the installed mobile app. They are unavailable in the web preview due to browser restrictions.
            </Text>
          </GlassCard>
        )}
        <GlassCard>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Hash Rate</Text>
            <Text style={styles.statValue}>{formatHashRate(oc?.hashRate ?? 0)}</Text>
          </View>
        </GlassCard>

        <GlassCard>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Difficulty</Text>
            <Text style={styles.statValue}>
              {oc?.difficulty?.difficultyChange != null ? `${oc.difficulty.difficultyChange > 0 ? '+' : ''}${oc.difficulty.difficultyChange.toFixed(2)}%` : '--'}
            </Text>
          </View>
          {oc?.difficulty?.remainingBlocks != null && (
            <Text style={styles.statSub}>{oc.difficulty.remainingBlocks} blocks until next adjustment ({oc?.difficulty?.progressPercent?.toFixed?.(1) ?? 0}%)</Text>
          )}
        </GlassCard>

        <GlassCard>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Mempool</Text>
            <View style={styles.congestionRow}>
              <Text style={styles.statValue}>{(oc?.mempool?.count ?? 0).toLocaleString()} txns</Text>
              <View style={[styles.congestionBadge, { backgroundColor: congestion.color + '33' }]}>
                <Text style={[styles.congestionText, { color: congestion.color }]}>{congestion.label}</Text>
              </View>
            </View>
          </View>
        </GlassCard>

        <GlassCard>
          <Text style={styles.cardTitle}>Fee Estimates (sat/vB)</Text>
          <View style={styles.feeRow}>
            {[
              { label: 'High', value: oc?.fees?.fastestFee, color: Colors.bearish },
              { label: 'Medium', value: oc?.fees?.halfHourFee, color: Colors.neutral },
              { label: 'Low', value: oc?.fees?.hourFee, color: Colors.bullish },
            ].map((f, i) => (
              <View key={i} style={styles.feeCol}>
                <Text style={[styles.feeLabel, { color: f.color }]}>{f.label}</Text>
                <Text style={styles.feeValue}>{f?.value ?? '--'}</Text>
              </View>
            ))}
          </View>
        </GlassCard>

        {/* Market Metrics */}
        <Text style={styles.sectionHeader}>Market Metrics</Text>
        <GlassCard>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>BTC Dominance</Text>
            <Text style={styles.statValue}>{data?.btcDominance?.toFixed?.(1) ?? '--'}%</Text>
          </View>
        </GlassCard>
        <GlassCard>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>24h Volume</Text>
            <Text style={styles.statValue}>
              {price?.volume_24h != null ? `$${(price.volume_24h / 1e9).toFixed(1)}B` : '--'}
            </Text>
          </View>
        </GlassCard>
        <GlassCard>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Market Cap</Text>
            <Text style={styles.statValue}>
              {price?.market_cap != null ? `$${(price.market_cap / 1e12).toFixed(2)}T` : '--'}
            </Text>
          </View>
        </GlassCard>
        <GlassCard>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Circulating Supply</Text>
            <Text style={styles.statValue}>
              {price?.circulating_supply != null
                ? `${(price.circulating_supply / 1e6).toFixed(2)}M (${((price.circulating_supply / 21e6) * 100).toFixed(1)}%)`
                : '--'}
            </Text>
          </View>
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
  sectionHeader: { ...Typography.heading, marginTop: Spacing.sm },
  webNotice: { borderColor: Colors.accent + '55', borderWidth: 1 },
  webNoticeText: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18 },
  gaugeCard: { alignItems: 'center' },
  fgHistoryRow: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: Spacing.lg },
  fgHistoryCol: { alignItems: 'center' },
  fgHistLabel: { ...Typography.caption, color: Colors.textTertiary },
  fgHistValue: { ...Typography.subheading, fontFamily: Fonts.mono, marginTop: 2 },
  fgHistClass: { ...Typography.caption, color: Colors.textSecondary, marginTop: 1 },
  fgChartCard: {},
  cardTitle: { ...Typography.body, fontWeight: '600', marginBottom: Spacing.md },
  fgChart: { flexDirection: 'row', height: 60 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { ...Typography.body, color: Colors.textSecondary },
  statValue: { ...Typography.monoData },
  statSub: { ...Typography.caption, color: Colors.textTertiary, marginTop: 4 },
  congestionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  congestionBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  congestionText: { ...Typography.caption, fontWeight: '700' },
  feeRow: { flexDirection: 'row', justifyContent: 'space-around' },
  feeCol: { alignItems: 'center' },
  feeLabel: { ...Typography.caption, fontWeight: '600' },
  feeValue: { ...Typography.monoData, marginTop: 4 },
});
