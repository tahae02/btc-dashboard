import React from 'react';
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
import { InfoButton } from '../../src/components/InfoButton';
import { useExplain } from '../../src/context/ExplainContext';
import { describeMarket, ACTION_PLAIN } from '../../src/services/plainEnglish';
import { formatMoney } from '../../src/services/format';
import { Colors, Typography, Spacing, BorderRadius, getSignalColor, getRegimeColor, Fonts } from '../../src/constants/theme';

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
  const { openGuide } = useExplain();
  const data = useData();
  const settings = useSettings();

  const candles = data?.ohlcv?.[settings.signalTimeframe] ?? [];
  const indicators = useIndicators(candles, settings.signalTimeframe);
  const signal = useSignalEngine({
    indicators,
    currentPrice: data?.price?.price ?? 0,
    fearGreed: data?.fearGreed?.current?.value ?? null,
    settings,
  });

  const price = data?.price;
  const isUp = (price?.change_24h_pct ?? 0) >= 0;
  const fg = data?.fearGreed;
  const hasSignal = candles.length >= 200;

  const priceDisplay = price?.price != null
    ? settings?.currency === 'GBP'
      ? `£${(price?.price_gbp ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : `$${price.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : '--';

  // Everything next to the headline price follows the chosen currency. It used
  // to show a pound price with the change, high and low still in dollars.
  // Converted at the rate implied by the live BTC price in each currency.
  const fx = settings?.currency === 'GBP' && price?.price && price?.price_gbp ? price.price_gbp / price.price : 1;
  const inCcy = (n: number | null | undefined): string =>
    n == null || isNaN(n) ? '--' : formatMoney(n * fx, settings?.currency === 'GBP' ? 'GBP' : 'USD');

  if (data?.isLoading && !price) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}><Text style={styles.headerTitle}>BTC Analyst</Text></View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <SkeletonLoader width="100%" height={140} />
          <SkeletonLoader width="100%" height={110} style={{ marginTop: Spacing.md }} />
          <View style={styles.statsGrid}>
            {[1, 2, 3, 4].map((i) => <SkeletonLoader key={i} width="48%" height={80} />)}
          </View>
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
          <Pressable onPress={() => data?.refresh?.()} hitSlop={8} accessibilityLabel="Refresh market data">
            <Ionicons name="refresh" size={20} color={Colors.accent} />
          </Pressable>
          <Pressable onPress={openGuide} hitSlop={8} accessibilityLabel="Jargon explained">
            <Ionicons name="book-outline" size={20} color={Colors.accent} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={data?.isLoading ?? false} onRefresh={() => data?.refresh?.()} tintColor={Colors.accent} />}
      >
        {data?.error && (
          <ErrorRetry message={data.error} compact={data.errorKind === 'partial'} onRetry={() => data?.refresh?.()} />
        )}

        {/* Price */}
        <GlassCard style={styles.heroCard}>
          <View style={styles.heroTop}>
            <Ionicons name="logo-bitcoin" size={24} color={Colors.neutral} />
            <Text style={styles.btcLabel}>Bitcoin</Text>
          </View>
          <Text style={styles.priceText}>{priceDisplay}</Text>
          <Text style={[styles.changeText, { color: isUp ? Colors.bullish : Colors.bearish }]}>
            {isUp ? '▲' : '▼'} {inCcy(Math.abs(price?.change_24h ?? 0))} ({(price?.change_24h_pct ?? 0).toFixed(2)}%)
          </Text>
          <View style={styles.hlRow}>
            <Text style={styles.hlText}>24h High: {inCcy(price?.high_24h)}</Text>
            <Text style={styles.hlText}>24h Low: {inCcy(price?.low_24h)}</Text>
          </View>
        </GlassCard>

        {/* The advice. Regime first, because it governs everything below it. */}
        <Pressable onPress={() => router.push('/tabs/signals')}>
          <GlassCard>
            {!hasSignal ? (
              <View>
                <Text style={styles.sectionTitle}>Building history</Text>
                <Text style={styles.waitingText}>
                  Needs 200 closed {settings.signalTimeframe} bars before it will call a regime.
                  Currently has {candles.length}.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.regimeRow}>
                  <View style={styles.labelRow}>
                    <Text style={styles.regimeLabel}>Market regime</Text>
                    <InfoButton term="regime" />
                  </View>
                  <View style={[styles.regimePill, { backgroundColor: getRegimeColor(signal.regime) + '22', borderColor: getRegimeColor(signal.regime) }]}>
                    <Text style={[styles.regimePillText, { color: getRegimeColor(signal.regime) }]}>
                      {signal.regime} {signal.regimeScore >= 0 ? '+' : ''}{signal.regimeScore}/3
                    </Text>
                  </View>
                </View>

                <View style={styles.actionRow}>
                  <View style={styles.labelRow}>
                    <SignalBadge signal={signal.actionLabel} />
                    <InfoButton term="action" />
                  </View>
                  <View style={styles.labelRow}>
                    <Text style={styles.convictionText}>Conviction {signal.conviction}%</Text>
                    <InfoButton term="conviction" />
                  </View>
                </View>
                <Text style={styles.actionPlain}>{ACTION_PLAIN[signal.action]}</Text>

                {/* Target allocation is the actual output. A filled bar is far
                    more legible than a number for "how much should I hold". */}
                <View style={[styles.labelRow, styles.allocLabelRow]}>
                  <Text style={styles.allocLabel}>
                    Target Bitcoin allocation: {(signal.targetAllocation * 100).toFixed(0)}%
                  </Text>
                  <InfoButton term="targetAllocation" />
                </View>
                <View style={styles.allocBar}>
                  <View style={[styles.allocFill, { width: `${signal.targetAllocation * 100}%`, backgroundColor: getSignalColor(signal.actionLabel) }]} />
                </View>

                <View style={[styles.labelRow, styles.dcaRow]}>
                <Text style={[styles.dcaText, styles.flex, { marginTop: 0 }]}>
                  {signal.dcaMultiplier === 1
                    ? 'Contribute your usual amount this period.'
                    : signal.dcaMultiplier > 1
                    ? `Consider ${signal.dcaMultiplier}× your usual contribution this period.`
                    : `Consider ${signal.dcaMultiplier}× your usual contribution, holding the rest as cash.`}
                </Text>
                <InfoButton term="dcaMultiplier" />
                </View>

                <Text style={styles.tapHint}>Tap for the full breakdown →</Text>
              </>
            )}
          </GlassCard>
        </Pressable>

        {/* The same call, in everyday language. Every sentence comes from a
            number the engine produced; nothing here adds a view of its own. */}
        {hasSignal && (
          <GlassCard>
            <View style={[styles.labelRow, { marginBottom: Spacing.sm }]}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={Colors.accent} />
              <Text style={styles.plainTitle}>In plain English</Text>
            </View>
            {describeMarket(signal, fg?.current?.value ?? null, fg?.current?.value_classification ?? null, settings.currency).map((line, i) => (
              <Text key={i} style={styles.plainText}>{line}</Text>
            ))}
            <Pressable onPress={openGuide} style={{ marginTop: Spacing.sm }} accessibilityRole="button">
              <Text style={styles.tapHint}>What do all these terms mean? →</Text>
            </Pressable>
          </GlassCard>
        )}

        {/* Kept adjacent to the advice rather than buried in Settings. */}
        <Text style={styles.disclaimer}>
          Not financial advice. A rules-based reading of price history, nothing more.
          Bitcoin has repeatedly fallen more than 70%.
        </Text>

        {/* Stats */}
        <View style={styles.statsGrid}>
          {[
            { label: 'Market Cap', term: 'marketCap', value: formatNum(price?.market_cap) },
            { label: '24h Volume', term: 'volume', value: formatNum(price?.volume_24h) },
            { label: 'BTC Dominance', term: 'dominance', value: data?.btcDominance != null ? `${data.btcDominance.toFixed(1)}%` : '--' },
            { label: 'Volatility (ATR)', term: 'atr', value: indicators?.atrPct != null ? `${indicators.atrPct.toFixed(1)}%` : '--' },
          ].map((stat, i) => (
            <GlassCard key={i} style={styles.statCard}>
              <View style={styles.statLabelRow}>
                <Text style={styles.statLabel}>{stat.label}</Text>
                <InfoButton term={stat.term} size={14} />
              </View>
              <Text style={styles.statValue}>{stat.value}</Text>
            </GlassCard>
          ))}
        </View>

        {/* Fear & Greed */}
        {fg && (
          <GlassCard style={styles.gaugeCard}>
            <View style={[styles.labelRow, styles.titleRow]}>
              <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Fear &amp; Greed Index</Text>
              <InfoButton term="fearGreed" />
            </View>
            <FearGreedGauge value={fg?.current?.value ?? 50} label={fg?.current?.value_classification ?? 'Neutral'} />
          </GlassCard>
        )}

        {/* Volatility bands. Explicitly not a forecast. */}
        {hasSignal && signal.projections && (
          <GlassCard>
            <View style={[styles.labelRow, styles.titleRow]}>
              <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Expected range</Text>
              <InfoButton term="expectedRange" />
            </View>
            {[
              { label: 'Next 24h', r: signal.projections.range1d },
              { label: 'Next 7d', r: signal.projections.range7d },
            ].map((row) => (
              <View key={row.label} style={styles.projRow}>
                <Text style={styles.projLabel}>{row.label}</Text>
                <Text style={styles.projValue}>
                  {inCcy(Math.max(0, row.r.low))} – {inCcy(row.r.high)}
                </Text>
              </View>
            ))}
            <Text style={styles.projNote}>{signal.projections.note}</Text>
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
  changeText: { ...Typography.monoData, fontSize: 16, marginTop: 4 },
  hlRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: Spacing.sm },
  hlText: { ...Typography.caption, color: Colors.textTertiary },
  regimeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  regimeLabel: { ...Typography.caption, color: Colors.textSecondary },
  regimePill: { borderRadius: BorderRadius.pill, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  regimePillText: { ...Typography.caption, fontWeight: '700' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  convictionText: { ...Typography.caption, color: Colors.textSecondary },
  allocLabel: { ...Typography.caption, color: Colors.textSecondary },
  allocBar: { height: 8, backgroundColor: Colors.elevated, borderRadius: 4, overflow: 'hidden' },
  allocFill: { height: '100%', borderRadius: 4 },
  dcaText: { ...Typography.body, color: Colors.textPrimary, marginTop: Spacing.md, lineHeight: 22 },
  tapHint: { ...Typography.caption, color: Colors.accent, marginTop: Spacing.md },
  waitingText: { ...Typography.body, color: Colors.textSecondary, lineHeight: 22 },
  disclaimer: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, paddingHorizontal: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, justifyContent: 'space-between' },
  statCard: { width: '47%', padding: Spacing.md },
  statLabel: { ...Typography.caption, color: Colors.textTertiary },
  statValue: { ...Typography.subheading, fontFamily: Fonts.mono, marginTop: 4 },
  gaugeCard: { alignItems: 'center' },
  sectionTitle: { ...Typography.subheading, marginBottom: Spacing.md, alignSelf: 'flex-start' },
  projRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.sm },
  projLabel: { ...Typography.body, color: Colors.textSecondary },
  projValue: { ...Typography.monoData },
  projNote: { ...Typography.caption, color: Colors.textTertiary, marginTop: Spacing.sm, lineHeight: 17 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  titleRow: { alignSelf: 'flex-start', marginBottom: Spacing.md },
  flex: { flex: 1 },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  allocLabelRow: { marginTop: Spacing.md, marginBottom: 6 },
  dcaRow: { alignItems: 'flex-start', marginTop: Spacing.md },
  actionPlain: { ...Typography.caption, color: Colors.textSecondary, marginTop: Spacing.sm, lineHeight: 17 },
  plainTitle: { ...Typography.subheading },
  plainText: { ...Typography.body, color: Colors.textSecondary, lineHeight: 23, fontSize: 15, marginBottom: Spacing.sm },
});
