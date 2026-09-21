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
import { Colors, Typography, Spacing, getSignalColor, Fonts } from '../../src/constants/theme';
import { IndicatorSignal } from '../../src/types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function SignalsScreen() {
  const data = useData();
  const settings = useSettings();
  const candles = data?.ohlcv?.['1D'] ?? [];
  const indicators = useIndicators(candles);
  const signal = useSignalEngine({
    indicators,
    currentPrice: data?.price?.price ?? 0,
    settings,
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = useCallback((name: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(p => ({ ...p, [name]: !p[name] }));
  }, []);

  const totalIndicators = (signal?.indicators?.length ?? 0);

  if (data?.isLoading && !data?.price) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <SkeletonLoader width="100%" height={120} />
          <SkeletonLoader width="100%" height={40} style={{ marginTop: Spacing.md }} />
          {[1, 2, 3, 4, 5].map(i => <SkeletonLoader key={i} width="100%" height={60} style={{ marginTop: Spacing.sm }} />)}
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
        {/* Overall Signal Header */}
        <GlassCard style={styles.overallCard}>
          <SignalBadge signal={signal?.overall ?? 'NEUTRAL'} />
          <View style={styles.confRow}>
            <Text style={styles.confText}>Confidence: {signal?.confidence ?? 0}%</Text>
            <View style={styles.confBar}>
              <View style={[styles.confFill, { width: `${signal?.confidence ?? 0}%`, backgroundColor: getSignalColor(signal?.overall ?? 'NEUTRAL') }]} />
            </View>
          </View>
          <View style={styles.entryExitRow}>
            {signal?.entryPrice != null && (
              <View style={styles.entryExitCol}>
                <Text style={styles.eeLabel}>Entry (Support)</Text>
                <Text style={[styles.eeValue, { color: Colors.bullish }]}>${signal.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
            )}
            {signal?.exitPrice != null && (
              <View style={styles.entryExitCol}>
                <Text style={styles.eeLabel}>Target (Resistance)</Text>
                <Text style={[styles.eeValue, { color: Colors.bearish }]}>${signal.exitPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
            )}
          </View>
          <Text style={styles.basedOn}>Based on {totalIndicators} indicators</Text>
        </GlassCard>

        {/* Signal Summary Bar */}
        <View style={styles.summaryBar}>
          {(signal?.bullishCount ?? 0) > 0 && (
            <View style={[styles.summarySegment, { flex: signal?.bullishCount ?? 0, backgroundColor: Colors.bullish }]} />
          )}
          {(signal?.neutralCount ?? 0) > 0 && (
            <View style={[styles.summarySegment, { flex: signal?.neutralCount ?? 0, backgroundColor: Colors.neutral }]} />
          )}
          {(signal?.bearishCount ?? 0) > 0 && (
            <View style={[styles.summarySegment, { flex: signal?.bearishCount ?? 0, backgroundColor: Colors.bearish }]} />
          )}
        </View>
        <Text style={styles.summaryText}>
          {signal?.bullishCount ?? 0} Bullish · {signal?.neutralCount ?? 0} Neutral · {signal?.bearishCount ?? 0} Bearish
        </Text>

        {/* Indicator Signal List */}
        {(signal?.indicators ?? []).map((ind: IndicatorSignal, i: number) => {
          const isExpanded = expanded[ind?.name ?? ''] ?? false;
          return (
            <Pressable key={ind?.name ?? i} onPress={() => toggle(ind?.name ?? '')}>
              <GlassCard style={styles.indCard}>
                <View style={styles.indHeader}>
                  <View style={styles.indLeft}>
                    <Text style={styles.indName}>{ind?.name ?? ''}</Text>
                    <Text style={styles.indValue}>{ind?.value ?? '--'}</Text>
                  </View>
                  <View style={styles.indRight}>
                    <SignalBadge signal={ind?.signal ?? 'NEUTRAL'} compact />
                    <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textTertiary} style={{ marginLeft: 8 }} />
                  </View>
                </View>
                {isExpanded && (
                  <View style={styles.indExpanded}>
                    <Text style={styles.indExplanation}>{ind?.explanation ?? ''}</Text>
                    {ind?.thresholds && <Text style={styles.indThresholds}>{ind.thresholds}</Text>}
                  </View>
                )}
              </GlassCard>
            </Pressable>
          );
        })}

        {/* Price Targets */}
        {signal?.projections && (
          <GlassCard style={styles.targetsCard}>
            <Text style={styles.sectionTitle}>Price Targets</Text>
            {signal.projections.nextResistance != null && (
              <View style={styles.targetRow}>
                <Text style={styles.targetLabel}>↑ Next Resistance</Text>
                <View>
                  <Text style={styles.targetValue}>${signal.projections.nextResistance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                  {(data?.price?.price ?? 0) > 0 && (
                    <Text style={styles.targetPct}>{(((signal.projections.nextResistance - (data?.price?.price ?? 0)) / (data?.price?.price ?? 1)) * 100).toFixed(1)}% away</Text>
                  )}
                </View>
              </View>
            )}
            {signal.projections.nextSupport != null && (
              <View style={styles.targetRow}>
                <Text style={styles.targetLabel}>↓ Next Support</Text>
                <View>
                  <Text style={styles.targetValue}>${signal.projections.nextSupport.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                  {(data?.price?.price ?? 0) > 0 && (
                    <Text style={styles.targetPct}>{((((data?.price?.price ?? 0) - signal.projections.nextSupport) / (data?.price?.price ?? 1)) * 100).toFixed(1)}% away</Text>
                  )}
                </View>
              </View>
            )}
            <View style={styles.targetRow}>
              <Text style={styles.targetLabel}>24h Range</Text>
              <Text style={styles.targetValue}>
                ${signal.projections.range24h.low.toLocaleString(undefined, { maximumFractionDigits: 0 })} – ${signal.projections.range24h.high.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </Text>
            </View>
            <View style={styles.scenarioRow}>
              {[
                { label: 'Bear 7d', value: signal.projections.scenario7d.bear, color: Colors.bearish },
                { label: 'Base 7d', value: signal.projections.scenario7d.base, color: Colors.neutral },
                { label: 'Bull 7d', value: signal.projections.scenario7d.bull, color: Colors.bullish },
              ].map((s, idx) => (
                <View key={idx} style={styles.scenarioCol}>
                  <Text style={[styles.scenarioLabel, { color: s.color }]}>{s.label}</Text>
                  <Text style={styles.scenarioValue}>${s.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                </View>
              ))}
            </View>
          </GlassCard>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.md },
  overallCard: {},
  confRow: { marginTop: Spacing.md },
  confText: { ...Typography.caption, marginBottom: 4 },
  confBar: { height: 4, backgroundColor: Colors.elevated, borderRadius: 2, overflow: 'hidden' },
  confFill: { height: '100%', borderRadius: 2 },
  entryExitRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: Spacing.lg },
  entryExitCol: { alignItems: 'center' },
  eeLabel: { ...Typography.caption, color: Colors.textTertiary },
  eeValue: { ...Typography.subheading, fontFamily: Fonts.mono, marginTop: 2 },
  basedOn: { ...Typography.caption, color: Colors.textTertiary, marginTop: Spacing.md, textAlign: 'center' },
  summaryBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: Colors.elevated },
  summarySegment: { height: '100%' },
  summaryText: { ...Typography.caption, color: Colors.textSecondary, textAlign: 'center', marginTop: 4 },
  indCard: { marginTop: 0 },
  indHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  indLeft: { flex: 1 },
  indName: { ...Typography.body, fontWeight: '600' },
  indValue: { ...Typography.monoData, color: Colors.textSecondary, marginTop: 2 },
  indRight: { flexDirection: 'row', alignItems: 'center' },
  indExpanded: { marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.cardBorder },
  indExplanation: { ...Typography.body, color: Colors.textSecondary, lineHeight: 22 },
  indThresholds: { ...Typography.caption, color: Colors.textTertiary, marginTop: Spacing.sm, fontStyle: 'italic' },
  sectionTitle: { ...Typography.subheading, marginBottom: Spacing.md },
  targetsCard: {},
  targetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  targetLabel: { ...Typography.body, color: Colors.textSecondary },
  targetValue: { ...Typography.monoData, textAlign: 'right' },
  targetPct: { ...Typography.caption, color: Colors.textTertiary, textAlign: 'right' },
  scenarioRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.cardBorder },
  scenarioCol: { alignItems: 'center' },
  scenarioLabel: { ...Typography.caption, fontWeight: '600' },
  scenarioValue: { ...Typography.monoData, marginTop: 4 },
});
