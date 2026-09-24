import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Dimensions, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CandleStickChart } from 'react-native-gifted-charts';
import { useData } from '../../src/context/DataContext';
import { useSettings } from '../../src/context/SettingsContext';
import { useIndicators } from '../../src/hooks/useIndicators';
import { GlassCard } from '../../src/components/GlassCard';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { buildChartWindow, visibleCandleCount, formatPriceShort } from '../../src/services/chartWindow';
import { Colors, Typography, Spacing, BorderRadius } from '../../src/constants/theme';
import type { Timeframe } from '../../src/types';

const TIMEFRAMES: Timeframe[] = ['1H', '4H', '1D', '1W'];
const screenWidth = Dimensions.get('window').width;

// Screen side padding (2 x 16), card padding (2 x 8) and the y-axis labels
// (~40). What remains is the plot area the candles have to fit into.
const RESERVED_WIDTH = 32 + 16 + 40;
const CANDLE_SPACING = 8;
const PLOT_WIDTH = screenWidth - RESERVED_WIDTH;
// Bounded on purpose: drawing all ~720 candles made one enormous SVG that
// Android kills the app over. See src/services/chartWindow.ts.
const VISIBLE_CANDLES = visibleCandleCount(screenWidth, CANDLE_SPACING, RESERVED_WIDTH);

/**
 * Overlays are single-select.
 *
 * The previous screen had six independent toggles that drew nothing: the
 * chart component only ever received OHLC data, so switching "EMA 9" on just
 * printed a number in a card underneath. `CandleStickChart` takes one overlay
 * series (`showLine` + `lineData`), so the control is now a radio rather than
 * a set of checkboxes that promise more than the chart can render.
 */
type OverlayKey = 'none' | 'ema9' | 'ema21' | 'sma50' | 'sma200' | 'bbUpper' | 'bbLower';

const OVERLAYS: { key: OverlayKey; label: string; color: string }[] = [
  { key: 'none', label: 'None', color: Colors.textTertiary },
  { key: 'ema9', label: 'EMA 9', color: '#FFD600' },
  { key: 'ema21', label: 'EMA 21', color: '#FF9100' },
  { key: 'sma50', label: 'SMA 50', color: '#2979FF' },
  { key: 'sma200', label: 'SMA 200', color: '#AA00FF' },
  { key: 'bbUpper', label: 'BB upper', color: Colors.accent },
  { key: 'bbLower', label: 'BB lower', color: Colors.accent },
];

export default function ChartScreen() {
  const data = useData();
  const settings = useSettings();
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>(settings.signalTimeframe);
  const [overlay, setOverlay] = useState<OverlayKey>('none');
  const [loading, setLoading] = useState(false);

  const candles = data?.ohlcv?.[activeTimeframe] ?? [];
  const indicators = useIndicators(candles, activeTimeframe);

  const loadTf = useCallback(async (tf: Timeframe) => {
    setActiveTimeframe(tf);
    if ((data?.ohlcv?.[tf]?.length ?? 0) === 0) {
      setLoading(true);
      try { await data?.loadTimeframe?.(tf); } catch { /* keep whatever is shown */ }
      setLoading(false);
    }
  }, [data]);

  // Indicator series are index-aligned to the FULL candle history; the window
  // slices both together so the overlay lines up with the candles drawn.
  const overlayRaw = useMemo((): number[] | null => {
    switch (overlay) {
      case 'ema9': return indicators?.ema9Values ?? null;
      case 'ema21': return indicators?.ema21Values ?? null;
      case 'sma50': return indicators?.sma50Values ?? null;
      case 'sma200': return indicators?.sma200Values ?? null;
      case 'bbUpper': return indicators?.bollingerBands?.upperValues ?? null;
      case 'bbLower': return indicators?.bollingerBands?.lowerValues ?? null;
      default: return null;
    }
  }, [overlay, indicators]);

  const chartWindow = useMemo(
    () => buildChartWindow(candles, VISIBLE_CANDLES, overlayRaw),
    [candles, overlayRaw]
  );

  const overlayColor = OVERLAYS.find((o) => o.key === overlay)?.color ?? Colors.accent;

  const rsiValues = (indicators?.rsi?.values ?? []).filter((v) => !isNaN(v));
  const macdHist = (indicators?.macd?.histogramValues ?? []).filter((v) => !isNaN(v));

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={data?.isLoading ?? false} onRefresh={() => data?.refresh?.()} tintColor={Colors.accent} />}
      >
        <View style={styles.tfRow}>
          {TIMEFRAMES.map((tf) => (
            <Pressable key={tf} onPress={() => loadTf(tf)} style={[styles.tfPill, activeTimeframe === tf && styles.tfPillActive]}>
              <Text style={[styles.tfText, activeTimeframe === tf && styles.tfTextActive]}>{tf}</Text>
            </Pressable>
          ))}
        </View>

        {/* The chart timeframe is independent of the signal timeframe, and
            says so. Previously the chart offered four timeframes while the
            signal was hardcoded to 1D, with nothing to indicate the mismatch. */}
        {activeTimeframe !== settings.signalTimeframe && (
          <Text style={styles.tfNotice}>
            Viewing {activeTimeframe}. Signals are computed on {settings.signalTimeframe} — change that in Settings.
          </Text>
        )}

        <GlassCard style={styles.chartCard}>
          {loading ? (
            <View style={styles.loadingBox}><ActivityIndicator color={Colors.accent} size="large" /></View>
          ) : chartWindow.candles.length > 0 ? (
            // No outer horizontal ScrollView: the window already fits the
            // screen, and nesting one inside the chart's own scroller made two
            // same-direction scroll views fight over the gesture.
            <ErrorBoundary fallbackTitle="The chart could not be drawn" resetKey={`${activeTimeframe}:${overlay}`}>
              <CandleStickChart
                data={chartWindow.candles}
                width={PLOT_WIDTH}
                height={280}
                yAxisColor={Colors.cardBorder}
                xAxisColor={Colors.cardBorder}
                yAxisTextStyle={{ color: Colors.textTertiary, fontSize: 10 }}
                formatYLabel={(label: string) => formatPriceShort(Number(label) + chartWindow.base)}
                bullishColor={Colors.bullish}
                bearishColor={Colors.bearish}
                spacing={CANDLE_SPACING}
                showLine={chartWindow.overlay != null}
                lineData={chartWindow.overlay ?? undefined}
                lineConfig={{ color: overlayColor, thickness: 1.5, hideDataPoints: true, curved: false }}
              />
            </ErrorBoundary>
          ) : (
            <View style={styles.loadingBox}><Text style={styles.noData}>No chart data available</Text></View>
          )}
        </GlassCard>

        {chartWindow.candles.length > 0 && !loading && (
          <Text style={styles.windowNote}>
            Showing the latest {chartWindow.candles.length} {activeTimeframe} candles. Indicators are calculated on the full history.
          </Text>
        )}

        <Text style={styles.sectionLabel}>Overlay</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.overlayRow}>
          {OVERLAYS.map((o) => (
            <Pressable
              key={o.key}
              onPress={() => setOverlay(o.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: overlay === o.key }}
              style={[styles.overlayChip, overlay === o.key && { backgroundColor: o.color + '33', borderColor: o.color }]}
            >
              {o.key !== 'none' && <View style={[styles.overlayDot, { backgroundColor: o.color }]} />}
              <Text style={[styles.overlayLabel, overlay === o.key && { color: o.color }]}>{o.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {candles.length > 0 && (
          <GlassCard>
            <Text style={styles.sectionLabel}>Current values</Text>
            {([
              ['EMA 9', indicators?.ema9, '#FFD600'],
              ['EMA 21', indicators?.ema21, '#FF9100'],
              ['SMA 50', indicators?.sma50, '#2979FF'],
              ['SMA 200', indicators?.sma200, '#AA00FF'],
            ] as const).map(([label, value, color]) =>
              value != null ? (
                <Text key={label} style={[styles.ovVal, { color }]}>{label}: ${value.toFixed(0)}</Text>
              ) : null
            )}
            {indicators?.bollingerBands && (
              <Text style={[styles.ovVal, { color: Colors.accent }]}>
                Bollinger: ${indicators.bollingerBands.lower.toFixed(0)} / ${indicators.bollingerBands.middle.toFixed(0)} / ${indicators.bollingerBands.upper.toFixed(0)}
              </Text>
            )}
          </GlassCard>
        )}

        {rsiValues.length > 0 && (
          <GlassCard>
            <Text style={styles.sectionLabel}>RSI (14): {indicators?.rsi?.value?.toFixed(1) ?? '--'}</Text>
            <View style={styles.miniChart}>
              <View style={styles.miniChartBg}>
                {/* Overbought band sits at the top, oversold at the bottom. */}
                <View style={[styles.rsiZone, { bottom: '70%', backgroundColor: Colors.bearish + '15' }]} />
                <View style={[styles.rsiZone, { top: '70%', backgroundColor: Colors.bullish + '15' }]} />
                <View style={[styles.rsiLine, { bottom: '70%' }]} />
                <View style={[styles.rsiLine, { bottom: '30%' }]} />
                {rsiValues.slice(-40).map((v, i, arr) => (
                  <View
                    key={i}
                    style={{
                      position: 'absolute',
                      left: `${(i / (arr.length - 1 || 1)) * 100}%`,
                      bottom: `${Math.min(100, Math.max(0, v))}%`,
                      width: 3,
                      height: 3,
                      borderRadius: 1.5,
                      backgroundColor: v >= 70 ? Colors.bearish : v <= 30 ? Colors.bullish : Colors.accent,
                    }}
                  />
                ))}
              </View>
            </View>
          </GlassCard>
        )}

        {macdHist.length > 0 && (
          <GlassCard>
            <Text style={styles.sectionLabel}>MACD histogram</Text>
            <View style={styles.miniChart}>
              <View style={styles.miniChartBg}>
                <View style={[styles.rsiLine, { bottom: '50%' }]} />
                {(() => {
                  const slice = macdHist.slice(-40);
                  const peak = Math.max(...slice.map((v) => Math.abs(v)), 1e-9);
                  return slice.map((v, i, arr) => {
                    const halfPct = (Math.abs(v) / peak) * 45;
                    return (
                      <View
                        key={i}
                        style={{
                          position: 'absolute',
                          left: `${(i / (arr.length - 1 || 1)) * 100}%`,
                          bottom: v >= 0 ? '50%' : `${50 - halfPct}%`,
                          width: 3,
                          height: `${halfPct}%`,
                          backgroundColor: v >= 0 ? Colors.bullish : Colors.bearish,
                        }}
                      />
                    );
                  });
                })()}
              </View>
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
  tfRow: { flexDirection: 'row', gap: Spacing.sm },
  tfPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: BorderRadius.pill, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  tfPillActive: { backgroundColor: Colors.accent + '22', borderColor: Colors.accent },
  tfText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600' },
  tfTextActive: { color: Colors.accent },
  tfNotice: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17 },
  windowNote: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, marginTop: -Spacing.xs },
  chartCard: { padding: Spacing.sm },
  loadingBox: { height: 280, alignItems: 'center', justifyContent: 'center' },
  noData: { ...Typography.body, color: Colors.textTertiary },
  overlayRow: { flexGrow: 0 },
  overlayChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: BorderRadius.pill, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, borderWidth: 1, borderColor: Colors.cardBorder },
  overlayDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  overlayLabel: { ...Typography.caption, color: Colors.textSecondary },
  sectionLabel: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  ovVal: { ...Typography.monoData, marginTop: 6 },
  miniChart: { height: 80, marginTop: Spacing.sm },
  miniChartBg: { flex: 1, position: 'relative', backgroundColor: Colors.elevated, borderRadius: 4, overflow: 'hidden' },
  rsiZone: { position: 'absolute', left: 0, right: 0, height: '30%' },
  rsiLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Colors.textTertiary, opacity: 0.3 },
});
