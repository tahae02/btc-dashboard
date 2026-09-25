import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, LayoutAnimation, Platform, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../src/context/DataContext';
import { useSettings } from '../../src/context/SettingsContext';
import { useIndicators } from '../../src/hooks/useIndicators';
import { useSignalEngine } from '../../src/hooks/useSignalEngine';
import { GlassCard } from '../../src/components/GlassCard';
import { SignalBadge } from '../../src/components/SignalBadge';
import { SkeletonLoader } from '../../src/components/SkeletonLoader';
import { TrackRecordCard } from '../../src/components/TrackRecordCard';
import { Colors, Typography, Spacing, BorderRadius, getSignalColor, getRegimeColor, Fonts } from '../../src/constants/theme';
import type { IndicatorReading, IndicatorFamily } from '../../src/types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Readings are grouped by the layer they belong to, and the groups are shown
 * in the order they are applied. The point is to make the hierarchy visible:
 * the regime decides the call, the faster layers only adjust it, and context
 * rows do not vote at all. The old screen listed nine equal-looking rows,
 * which implied nine independent opinions that did not exist.
 */
const FAMILY_ORDER: IndicatorFamily[] = ['REGIME', 'STRETCH', 'MOMENTUM', 'SENTIMENT', 'CONTEXT'];

const FAMILY_TITLE: Record<IndicatorFamily, string> = {
  REGIME: '1. Regime — sets the base allocation',
  STRETCH: '2. Stretch — adjusts within the regime',
  MOMENTUM: '3. Momentum — confirms or tempers',
  SENTIMENT: '4. Sentiment — contrarian, extremes only',
  CONTEXT: 'Context — does not affect the allocation',
};

export default function SignalsScreen() {
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

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = useCallback((name: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((p) => ({ ...p, [name]: !p[name] }));
  }, []);

  const price = data?.price?.price ?? 0;
  const hasSignal = candles.length >= 200;

  if (data?.isLoading && !data?.price) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <SkeletonLoader width="100%" height={180} />
          {[1, 2, 3, 4].map((i) => <SkeletonLoader key={i} width="100%" height={70} style={{ marginTop: Spacing.sm }} />)}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const grouped = FAMILY_ORDER
    .map((family) => ({ family, rows: (signal?.readings ?? []).filter((r) => r.family === family) }))
    .filter((g) => g.rows.length > 0);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={data?.isLoading ?? false} onRefresh={() => data?.refresh?.()} tintColor={Colors.accent} />}
      >
        {!hasSignal ? (
          <GlassCard>
            <Text style={styles.sectionTitle}>Not enough history yet</Text>
            <Text style={styles.bodyText}>
              The regime read needs 200 closed {settings.signalTimeframe} bars. There are {candles.length}.
              Pull to refresh, or pick a shorter timeframe in Settings.
            </Text>
          </GlassCard>
        ) : (
          <>
            <GlassCard>
              <View style={styles.regimeRow}>
                <Text style={styles.regimeLabel}>Market regime</Text>
                <View style={[styles.regimePill, { backgroundColor: getRegimeColor(signal.regime) + '22', borderColor: getRegimeColor(signal.regime) }]}>
                  <Text style={[styles.regimePillText, { color: getRegimeColor(signal.regime) }]}>
                    {signal.regime} {signal.regimeScore >= 0 ? '+' : ''}{signal.regimeScore}/3
                  </Text>
                </View>
              </View>

              <SignalBadge signal={signal.actionLabel} />

              <Text style={styles.allocLabel}>
                Target Bitcoin allocation: {(signal.targetAllocation * 100).toFixed(0)}%
              </Text>
              <View style={styles.allocBar}>
                <View style={[styles.allocFill, { width: `${signal.targetAllocation * 100}%`, backgroundColor: getSignalColor(signal.actionLabel) }]} />
              </View>

              <View style={styles.metaGrid}>
                <View style={styles.metaCell}>
                  <Text style={styles.metaLabel}>Conviction</Text>
                  <Text style={styles.metaValue}>{signal.conviction}%</Text>
                  <Text style={styles.metaHint}>agreement between layers</Text>
                </View>
                <View style={styles.metaCell}>
                  <Text style={styles.metaLabel}>DCA this period</Text>
                  <Text style={styles.metaValue}>{signal.dcaMultiplier}×</Text>
                  <Text style={styles.metaHint}>vs your usual amount</Text>
                </View>
              </View>

              <Text style={styles.disclaimer}>
                Not financial advice. This reads price history by fixed rules. It cannot know
                anything about the future, and Bitcoin has repeatedly fallen more than 70%.
              </Text>
            </GlassCard>

            {grouped.map((group) => (
              <View key={group.family} style={styles.group}>
                <Text style={styles.groupTitle}>{FAMILY_TITLE[group.family]}</Text>
                {group.rows.map((reading: IndicatorReading) => {
                  const isOpen = expanded[reading.name] ?? false;
                  return (
                    <Pressable key={reading.name} onPress={() => toggle(reading.name)}>
                      <GlassCard style={styles.readingCard}>
                        <View style={styles.readingHeader}>
                          <View style={styles.readingLeft}>
                            <Text style={styles.readingName}>{reading.name}</Text>
                            <Text style={styles.readingValue}>{reading.value}</Text>
                          </View>
                          <View style={styles.readingRight}>
                            {/* Stating the weight inline stops a context row
                                from reading like a buy or sell call. */}
                            <Text style={styles.weightText}>{reading.weight}</Text>
                            <SignalBadge signal={reading.signal} compact />
                            <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textTertiary} style={{ marginLeft: 6 }} />
                          </View>
                        </View>
                        {isOpen && (
                          <View style={styles.readingBody}>
                            <Text style={styles.readingExplanation}>{reading.explanation}</Text>
                          </View>
                        )}
                      </GlassCard>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            {signal.projections && (
              <GlassCard>
                <Text style={styles.sectionTitle}>Levels &amp; expected range</Text>
                {signal.projections.nextSupport != null && (
                  <View style={styles.projRow}>
                    <Text style={styles.projLabel}>↓ Nearest support</Text>
                    <View>
                      <Text style={styles.projValue}>${signal.projections.nextSupport.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                      {price > 0 && (
                        <Text style={styles.projPct}>{(((price - signal.projections.nextSupport) / price) * 100).toFixed(1)}% below</Text>
                      )}
                    </View>
                  </View>
                )}
                {signal.projections.nextResistance != null && (
                  <View style={styles.projRow}>
                    <Text style={styles.projLabel}>↑ Nearest resistance</Text>
                    <View>
                      <Text style={styles.projValue}>${signal.projections.nextResistance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                      {price > 0 && (
                        <Text style={styles.projPct}>{(((signal.projections.nextResistance - price) / price) * 100).toFixed(1)}% above</Text>
                      )}
                    </View>
                  </View>
                )}
                {[
                  { label: 'Next 24h range', r: signal.projections.range1d },
                  { label: 'Next 7d range', r: signal.projections.range7d },
                ].map((row) => (
                  <View key={row.label} style={styles.projRow}>
                    <Text style={styles.projLabel}>{row.label}</Text>
                    <Text style={styles.projValue}>
                      ${Math.max(0, row.r.low).toLocaleString(undefined, { maximumFractionDigits: 0 })} – ${row.r.high.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </Text>
                  </View>
                ))}
                <Text style={styles.projNote}>{signal.projections.note}</Text>
              </GlassCard>
            )}
          </>
        )}

        {/* Runs on daily bars whatever the signal timeframe, since that is
            what the engine's calls are scored against. */}
        <TrackRecordCard />

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.md },
  sectionTitle: { ...Typography.subheading, marginBottom: Spacing.md },
  bodyText: { ...Typography.body, color: Colors.textSecondary, lineHeight: 22 },
  regimeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  regimeLabel: { ...Typography.caption, color: Colors.textSecondary },
  regimePill: { borderRadius: BorderRadius.pill, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  regimePillText: { ...Typography.caption, fontWeight: '700' },
  allocLabel: { ...Typography.caption, color: Colors.textSecondary, marginTop: Spacing.md, marginBottom: 6 },
  allocBar: { height: 8, backgroundColor: Colors.elevated, borderRadius: 4, overflow: 'hidden' },
  allocFill: { height: '100%', borderRadius: 4 },
  metaGrid: { flexDirection: 'row', marginTop: Spacing.lg, gap: Spacing.md },
  metaCell: { flex: 1 },
  metaLabel: { ...Typography.caption, color: Colors.textTertiary },
  metaValue: { ...Typography.subheading, fontFamily: Fonts.mono, marginTop: 2 },
  metaHint: { ...Typography.caption, color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  disclaimer: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, marginTop: Spacing.lg },
  group: { gap: Spacing.sm },
  groupTitle: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '700', marginTop: Spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  readingCard: { paddingVertical: Spacing.md },
  readingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  readingLeft: { flex: 1 },
  readingName: { ...Typography.body, fontWeight: '600' },
  readingValue: { ...Typography.monoData, color: Colors.textSecondary, marginTop: 2 },
  readingRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  weightText: { ...Typography.caption, color: Colors.textTertiary, fontSize: 10 },
  readingBody: { marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.cardBorder },
  readingExplanation: { ...Typography.body, color: Colors.textSecondary, lineHeight: 22, fontSize: 15 },
  projRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  projLabel: { ...Typography.body, color: Colors.textSecondary },
  projValue: { ...Typography.monoData, textAlign: 'right' },
  projPct: { ...Typography.caption, color: Colors.textTertiary, textAlign: 'right' },
  projNote: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17 },
});
