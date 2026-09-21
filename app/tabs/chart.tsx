import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Dimensions, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CandleStickChart } from 'react-native-gifted-charts';
import { useData } from '../../src/context/DataContext';
import { useSettings } from '../../src/context/SettingsContext';
import { useIndicators } from '../../src/hooks/useIndicators';
import { GlassCard } from '../../src/components/GlassCard';
import { Colors, Typography, Spacing, BorderRadius, Fonts } from '../../src/constants/theme';
import { Timeframe, OHLCVCandle } from '../../src/types';

const TIMEFRAMES: Timeframe[] = ['1H', '4H', '1D', '1W'];
const screenWidth = Dimensions.get('window').width;

export default function ChartScreen() {
  const data = useData();
  const settings = useSettings();
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>('1D');
  const [overlays, setOverlays] = useState<Record<string, boolean>>({ ema9: false, ema21: false, sma50: false, sma200: false, bbands: false, volume: true });
  const [loading, setLoading] = useState(false);

  const candles = data?.ohlcv?.[activeTimeframe] ?? [];
  const indicators = useIndicators(candles);

  const loadTf = useCallback(async (tf: Timeframe) => {
    setActiveTimeframe(tf);
    if ((data?.ohlcv?.[tf]?.length ?? 0) === 0) {
      setLoading(true);
      try {
        await (data as any)?.loadTimeframe?.(tf);
      } catch { /* ignore */ }
      setLoading(false);
    }
  }, [data]);

  const toggleOverlay = (key: string) => setOverlays(p => ({ ...p, [key]: !p[key] }));

  // Format candles for CandlestickChart
  const chartData = useMemo(() => {
    return candles.map((c) => ({
      open: c?.open ?? 0,
      high: c?.high ?? 0,
      low: c?.low ?? 0,
      close: c?.close ?? 0,
    }));
  }, [candles]);

  // RSI data for mini chart display
  const rsiValues = indicators?.rsi?.values?.filter?.((v: number) => !isNaN(v)) ?? [];
  const macdHist = indicators?.macd?.histogramValues?.filter?.((v: number) => !isNaN(v)) ?? [];

  const chartWidth = Math.max(screenWidth - 32, chartData.length * 8);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={data?.isLoading ?? false} onRefresh={() => data?.refresh?.()} tintColor={Colors.accent} />}
      >
        {/* Timeframe pills */}
        <View style={styles.tfRow}>
          {TIMEFRAMES.map(tf => (
            <Pressable key={tf} onPress={() => loadTf(tf)} style={[styles.tfPill, activeTimeframe === tf && styles.tfPillActive]}>
              <Text style={[styles.tfText, activeTimeframe === tf && styles.tfTextActive]}>{tf}</Text>
            </Pressable>
          ))}
        </View>

        {/* Main Chart */}
        <GlassCard style={styles.chartCard}>
          {loading ? (
            <View style={styles.loadingBox}><ActivityIndicator color={Colors.accent} size="large" /></View>
          ) : chartData.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <CandleStickChart
                data={chartData}
                width={chartWidth}
                height={280}
                yAxisColor={Colors.cardBorder}
                xAxisColor={Colors.cardBorder}
                yAxisTextStyle={{ color: Colors.textTertiary, fontSize: 10 }}
                bullishColor={Colors.bullish}
                bearishColor={Colors.bearish}
                spacing={8}
              />
            </ScrollView>
          ) : (
            <View style={styles.loadingBox}><Text style={styles.noData}>No chart data available</Text></View>
          )}
        </GlassCard>

        {/* Overlay Toggles */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.overlayRow}>
          {[
            { key: 'ema9', label: 'EMA 9', color: '#FFD600' },
            { key: 'ema21', label: 'EMA 21', color: '#FF9100' },
            { key: 'sma50', label: 'SMA 50', color: '#2979FF' },
            { key: 'sma200', label: 'SMA 200', color: '#AA00FF' },
            { key: 'bbands', label: 'BBands', color: Colors.accent },
            { key: 'volume', label: 'Volume', color: Colors.textSecondary },
          ].map(o => (
            <Pressable key={o.key} onPress={() => toggleOverlay(o.key)} style={[styles.overlayChip, overlays[o.key] && { backgroundColor: o.color + '33', borderColor: o.color }]}>
              <View style={[styles.overlayDot, { backgroundColor: o.color }]} />
              <Text style={[styles.overlayLabel, overlays[o.key] && { color: o.color }]}>{o.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Overlay values summary */}
        {candles.length > 0 && (
          <GlassCard style={styles.overlayValues}>
            <Text style={styles.sectionLabel}>Indicator Values</Text>
            {overlays.ema9 && indicators?.ema9 != null && <Text style={[styles.ovVal, { color: '#FFD600' }]}>EMA 9: ${indicators.ema9.toFixed(0)}</Text>}
            {overlays.ema21 && indicators?.ema21 != null && <Text style={[styles.ovVal, { color: '#FF9100' }]}>EMA 21: ${indicators.ema21.toFixed(0)}</Text>}
            {overlays.sma50 && indicators?.sma50 != null && <Text style={[styles.ovVal, { color: '#2979FF' }]}>SMA 50: ${indicators.sma50.toFixed(0)}</Text>}
            {overlays.sma200 && indicators?.sma200 != null && <Text style={[styles.ovVal, { color: '#AA00FF' }]}>SMA 200: ${indicators.sma200.toFixed(0)}</Text>}
            {overlays.bbands && indicators?.bollingerBands != null && (
              <Text style={[styles.ovVal, { color: Colors.accent }]}>
                BBands: ${indicators.bollingerBands.lower.toFixed(0)} / ${indicators.bollingerBands.middle.toFixed(0)} / ${indicators.bollingerBands.upper.toFixed(0)}
              </Text>
            )}
          </GlassCard>
        )}

        {/* RSI Sub-Chart */}
        {rsiValues.length > 0 && (
          <GlassCard style={styles.subChart}>
            <Text style={styles.sectionLabel}>RSI (14): {indicators?.rsi?.value?.toFixed?.(1) ?? '--'}</Text>
            <View style={styles.miniChart}>
              <View style={styles.miniChartBg}>
                <View style={[styles.rsiZone, { bottom: '70%', backgroundColor: Colors.bearish + '15' }]} />
                <View style={[styles.rsiZone, { top: '70%', backgroundColor: Colors.bullish + '15' }]} />
                <View style={[styles.rsiLine, { bottom: '70%' }]} />
                <View style={[styles.rsiLine, { bottom: '30%' }]} />
                {rsiValues.slice(-40).map((v: number, i: number, arr: number[]) => (
                  <View
                    key={i}
                    style={{
                      position: 'absolute',
                      left: `${(i / (arr.length - 1 || 1)) * 100}%`,
                      bottom: `${v}%`,
                      width: 3,
                      height: 3,
                      borderRadius: 1.5,
                      backgroundColor: v > 70 ? Colors.bearish : v < 30 ? Colors.bullish : Colors.accent,
                    }}
                  />
                ))}
              </View>
            </View>
          </GlassCard>
        )}

        {/* MACD Sub-Chart */}
        {macdHist.length > 0 && (
          <GlassCard style={styles.subChart}>
            <Text style={styles.sectionLabel}>
              MACD: {indicators?.macd?.macdLine?.toFixed?.(0) ?? '--'} | Signal: {indicators?.macd?.signalLine?.toFixed?.(0) ?? '--'}
            </Text>
            <View style={styles.miniChart}>
              <View style={styles.macdBars}>
                {macdHist.slice(-40).map((v: number, i: number) => {
                  const maxAbs = Math.max(...macdHist.slice(-40).map(Math.abs), 1);
                  const h = Math.abs(v) / maxAbs * 50;
                  return (
                    <View
                      key={i}
                      style={{
                        width: 4,
                        height: `${h}%`,
                        backgroundColor: v >= 0 ? Colors.bullish : Colors.bearish,
                        marginHorizontal: 1,
                        alignSelf: v >= 0 ? 'flex-end' : 'flex-start',
                        ...(v >= 0 ? { marginBottom: 0 } : { marginTop: 0 }),
                      }}
                    />
                  );
                })}
              </View>
            </View>
          </GlassCard>
        )}

        {/* Chart Legend */}
        <View style={styles.legend}>
          <View style={[styles.legendItem]}>
            <View style={[styles.legendDot, { backgroundColor: Colors.bullish }]} />
            <Text style={styles.legendText}>Bullish</Text>
          </View>
          <View style={[styles.legendItem]}>
            <View style={[styles.legendDot, { backgroundColor: Colors.bearish }]} />
            <Text style={styles.legendText}>Bearish</Text>
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  tfRow: { flexDirection: 'row', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
  tfPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: BorderRadius.pill, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  tfPillActive: { backgroundColor: Colors.accent + '22', borderColor: Colors.accent },
  tfText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600' },
  tfTextActive: { color: Colors.accent },
  chartCard: { marginHorizontal: Spacing.lg, overflow: 'hidden' },
  loadingBox: { height: 280, justifyContent: 'center', alignItems: 'center' },
  noData: { ...Typography.body, color: Colors.textTertiary },
  overlayRow: { flexGrow: 0, paddingHorizontal: Spacing.lg, marginTop: Spacing.md },
  overlayChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.cardBorder, marginRight: 8 },
  overlayDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  overlayLabel: { ...Typography.caption, color: Colors.textSecondary },
  overlayValues: { marginHorizontal: Spacing.lg, marginTop: Spacing.md },
  sectionLabel: { ...Typography.body, fontWeight: '600', marginBottom: Spacing.sm },
  ovVal: { ...Typography.monoData, marginBottom: 2 },
  subChart: { marginHorizontal: Spacing.lg, marginTop: Spacing.md },
  miniChart: { height: 80, marginTop: Spacing.sm },
  miniChartBg: { flex: 1, position: 'relative', backgroundColor: Colors.elevated, borderRadius: 4, overflow: 'hidden' },
  rsiZone: { position: 'absolute', left: 0, right: 0, height: '30%' },
  rsiLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Colors.textTertiary, opacity: 0.3 },
  macdBars: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg, marginTop: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...Typography.caption },
});
