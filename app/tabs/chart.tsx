import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Dimensions, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { useData } from '../../src/context/DataContext';
import { useSettings } from '../../src/context/SettingsContext';
import { useJournal } from '../../src/context/JournalContext';
import { useIndicators } from '../../src/hooks/useIndicators';
import { GlassCard } from '../../src/components/GlassCard';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { InfoButton } from '../../src/components/InfoButton';
import { CandleChart, type ChartMarker, type ChartOverlay } from '../../src/components/CandleChart';
import { fetchOHLCV } from '../../src/services/api';
import { summariseHoldings, tradePricePerBtc } from '../../src/services/journal';
import { formatMoney } from '../../src/services/format';
import { Colors, Typography, Spacing, BorderRadius, Fonts } from '../../src/constants/theme';
import type { OHLCVCandle, Timeframe } from '../../src/types';

const TIMEFRAMES: Timeframe[] = ['1H', '4H', '1D', '1W'];
const screenWidth = Dimensions.get('window').width;
// Screen side padding (2 x 16) and card padding (2 x 8).
const CHART_WIDTH = screenWidth - 32 - 16;

/**
 * Overlays are single-select, except that Bollinger Bands are one choice that
 * draws its upper and lower lines together, as a pair.
 */
type OverlayKey = 'none' | 'ema9' | 'ema21' | 'sma50' | 'sma200' | 'bollinger';

const OVERLAY_PLAIN: Record<OverlayKey, string> = {
  none: 'Pick a line to draw over the candles. Tap the (i) for what they mean.',
  ema9: 'EMA 9: the average of the last 9 candles, leaning on the most recent. A fast, short-term trend line.',
  ema21: 'EMA 21: the average of the last 21 candles, leaning on the most recent. A short-term trend line, steadier than EMA 9.',
  sma50: 'SMA 50: the plain average of the last 50 candles. The medium-term trend; price above it is generally a good sign.',
  sma200:
    "SMA 200: the plain average of the last 200 candles. On daily candles this is the 200-day average the app's long-term trend is built on: above it is the healthier side.",
  bollinger:
    'Bollinger Bands: the range the price usually stays within. Near the top line the price is high for its recent range; near the bottom line it is low.',
};

const OVERLAYS: { key: OverlayKey; label: string; color: string }[] = [
  { key: 'none', label: 'None', color: Colors.textTertiary },
  { key: 'sma200', label: 'SMA 200', color: '#C77DFF' },
  { key: 'sma50', label: 'SMA 50', color: '#448AFF' },
  { key: 'ema21', label: 'EMA 21', color: '#FF9100' },
  { key: 'ema9', label: 'EMA 9', color: '#FFD600' },
  { key: 'bollinger', label: 'Bollinger', color: Colors.accent },
];

/**
 * Pound candles are Kraken's own BTC/GBP market, fetched when the currency
 * setting is pounds. Kept between visits to the tab for a few minutes.
 */
const gbpCache = new Map<Timeframe, { at: number; candles: OHLCVCandle[] }>();
const GBP_FRESH_MS = 5 * 60 * 1000;

export default function ChartScreen() {
  const data = useData();
  const settings = useSettings();
  const journal = useJournal();
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>(settings.signalTimeframe);
  // The 200 average by default: the long-term trend the advice is built on.
  const [overlay, setOverlay] = useState<OverlayKey>('sma200');
  const [showTrades, setShowTrades] = useState(true);
  const [loading, setLoading] = useState(false);
  const [scrollable, setScrollable] = useState(true);
  const [gbpCandles, setGbpCandles] = useState<OHLCVCandle[] | null>(() => gbpCache.get(activeTimeframe)?.candles ?? null);
  const [gbpFailed, setGbpFailed] = useState(false);

  const currency = settings.currency;
  const usdCandles = data?.ohlcv?.[activeTimeframe] ?? [];

  useEffect(() => {
    if (currency !== 'GBP') return;
    const cached = gbpCache.get(activeTimeframe);
    setGbpCandles(cached?.candles ?? null);
    setGbpFailed(false);
    if (cached && Date.now() - cached.at < GBP_FRESH_MS) return;
    let cancelled = false;
    fetchOHLCV(activeTimeframe, 'GBP')
      .then((c) => {
        if (cancelled) return;
        if (c.length) {
          gbpCache.set(activeTimeframe, { at: Date.now(), candles: c });
          setGbpCandles(c);
        } else if (!cached) setGbpFailed(true);
      })
      .catch(() => { if (!cancelled && !cached) setGbpFailed(true); });
    return () => { cancelled = true; };
  }, [currency, activeTimeframe]);

  // Pounds when you asked for pounds and Kraken's pound market loaded;
  // otherwise dollars, and the screen says so.
  const chartCurrency = currency === 'GBP' && gbpCandles?.length ? 'GBP' : 'USD';
  const candles = chartCurrency === 'GBP' ? gbpCandles! : usdCandles;
  // Lines are worked out on the candles drawn, so they sit on them.
  const drawn = useIndicators(candles, activeTimeframe);
  // RSI and MACD always come from BTC/USD, the market the advice reads, so
  // they match the Signals tab exactly.
  const usd = useIndicators(usdCandles, activeTimeframe);

  const loadTf = useCallback(async (tf: Timeframe) => {
    setActiveTimeframe(tf);
    if ((data?.ohlcv?.[tf]?.length ?? 0) === 0) {
      setLoading(true);
      try { await data?.loadTimeframe?.(tf); } catch { /* keep whatever is shown */ }
      setLoading(false);
    }
  }, [data]);

  const overlayColor = OVERLAYS.find((o) => o.key === overlay)?.color ?? Colors.accent;
  const overlays = useMemo((): ChartOverlay[] => {
    switch (overlay) {
      case 'ema9': return [{ key: 'ema9', values: drawn?.ema9Values, color: overlayColor }];
      case 'ema21': return [{ key: 'ema21', values: drawn?.ema21Values, color: overlayColor }];
      case 'sma50': return [{ key: 'sma50', values: drawn?.sma50Values, color: overlayColor }];
      case 'sma200': return [{ key: 'sma200', values: drawn?.sma200Values, color: overlayColor }];
      case 'bollinger':
        return [
          { key: 'bbUpper', values: drawn?.bollingerBands?.upperValues, color: overlayColor },
          { key: 'bbLower', values: drawn?.bollingerBands?.lowerValues, color: overlayColor },
        ];
      default: return [];
    }
  }, [overlay, drawn, overlayColor]);

  // Your real trades on the chart, at what you paid per BTC (fees included),
  // and a line at your average cost, both in the chart's currency.
  const live = { usd: data?.price?.price ?? 0, gbp: data?.price?.price_gbp ?? 0 };
  const markers = useMemo(
    (): ChartMarker[] =>
      journal.trades.map((t) => ({ time: t.time, price: tradePricePerBtc(t, chartCurrency, live), side: t.side })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [journal.trades, chartCurrency, live.usd, live.gbp]
  );
  const holdings = useMemo(
    () => summariseHoldings(journal.trades, chartCurrency, live, journal.opening),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [journal.trades, journal.opening, chartCurrency, live.usd, live.gbp]
  );
  const hasTrades = journal.trades.length > 0 || journal.opening != null;

  const rsiValues = (usd?.rsi?.values ?? []).filter((v) => !isNaN(v));
  const macdHist = (usd?.macd?.histogramValues ?? []).filter((v) => !isNaN(v));
  const ob = settings.rsiOverbought;
  const os = settings.rsiOversold;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chart</Text>
        <Text style={styles.headerSub}>BTC/{chartCurrency}</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        scrollEnabled={scrollable}
        refreshControl={<RefreshControl refreshing={data?.isLoading ?? false} onRefresh={() => data?.refresh?.()} tintColor={Colors.accent} />}
      >
        <View style={[styles.tfRow, { alignItems: 'center' }]}>
          {TIMEFRAMES.map((tf) => (
            <Pressable key={tf} onPress={() => loadTf(tf)} style={[styles.tfPill, activeTimeframe === tf && styles.tfPillActive]}>
              <Text style={[styles.tfText, activeTimeframe === tf && styles.tfTextActive]}>{tf}</Text>
            </Pressable>
          ))}
          <View style={{ flex: 1 }} />
          <InfoButton term="candles" size={20} />
        </View>

        {activeTimeframe !== settings.signalTimeframe && (
          <Text style={styles.tfNotice}>
            Viewing {activeTimeframe}. The advice is worked out on {settings.signalTimeframe}; change that in Settings.
          </Text>
        )}
        {currency === 'GBP' && gbpFailed && (
          <Text style={styles.tfNotice}>Pound prices did not load, so this chart is in dollars for now.</Text>
        )}

        <GlassCard style={styles.chartCard}>
          {loading ? (
            <View style={styles.loadingBox}><ActivityIndicator color={Colors.accent} size="large" /></View>
          ) : candles.length > 0 ? (
            <ErrorBoundary fallbackTitle="The chart could not be drawn" resetKey={`${activeTimeframe}:${overlay}:${chartCurrency}`}>
              <CandleChart
                key={`${activeTimeframe}:${chartCurrency}`}
                candles={candles}
                timeframe={activeTimeframe}
                currency={chartCurrency}
                width={CHART_WIDTH}
                overlays={overlays}
                band={overlay === 'bollinger' ? { upper: 'bbUpper', lower: 'bbLower', color: overlayColor } : null}
                markers={showTrades ? markers : []}
                averageCost={showTrades ? holdings.avgCost : null}
                onDragChange={(d) => setScrollable(!d)}
              />
            </ErrorBoundary>
          ) : (
            <View style={styles.loadingBox}><Text style={styles.noData}>No chart data available</Text></View>
          )}
        </GlassCard>

        <View style={styles.labelRow}>
          <Text style={styles.sectionLabel}>Line on the chart</Text>
          <InfoButton term={overlay === 'bollinger' ? 'bollinger' : 'movingAverages'} />
        </View>
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
          {hasTrades && (
            <Pressable
              onPress={() => setShowTrades((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: showTrades }}
              style={[styles.overlayChip, showTrades && { backgroundColor: Colors.accent + '22', borderColor: Colors.accent }]}
            >
              <View style={[styles.overlayDot, { backgroundColor: Colors.accent, borderRadius: 4 }]} />
              <Text style={[styles.overlayLabel, showTrades && { color: Colors.accent }]}>My trades</Text>
            </Pressable>
          )}
        </ScrollView>
        <Text style={styles.plainNote}>{OVERLAY_PLAIN[overlay]}</Text>
        {hasTrades && showTrades && (
          <Text style={styles.plainNote}>
            Dots are your real trades at what you paid per BTC, fees included. The dashed line is your average cost
            {holdings.avgCost != null ? `, ${formatMoney(holdings.avgCost, chartCurrency)}` : ''}: above it, what you hold is
            worth more than it cost.
          </Text>
        )}

        {candles.length > 0 && (
          <GlassCard>
            <Text style={styles.sectionLabel}>Current values ({activeTimeframe})</Text>
            {([
              ['SMA 200', drawn?.sma200, '#C77DFF'],
              ['SMA 50', drawn?.sma50, '#448AFF'],
              ['EMA 21', drawn?.ema21, '#FF9100'],
              ['EMA 9', drawn?.ema9, '#FFD600'],
            ] as const).map(([label, value, color]) =>
              value != null ? (
                <View key={label} style={styles.valueRow}>
                  <Text style={[styles.ovLabel, { color }]}>{label}</Text>
                  <Text style={styles.ovVal}>{formatMoney(value, chartCurrency)}</Text>
                </View>
              ) : null
            )}
            {drawn?.bollingerBands && (
              <View style={styles.valueRow}>
                <Text style={[styles.ovLabel, { color: Colors.accent }]}>Bollinger low / high</Text>
                <Text style={styles.ovVal}>
                  {formatMoney(drawn.bollingerBands.lower, chartCurrency)} / {formatMoney(drawn.bollingerBands.upper, chartCurrency)}
                </Text>
              </View>
            )}
          </GlassCard>
        )}

        {rsiValues.length > 1 && (
          <GlassCard>
            <View style={styles.labelRow}>
              <Text style={styles.sectionLabel}>RSI (14): {usd?.rsi?.value?.toFixed(1) ?? '--'}</Text>
              <InfoButton term="rsi" />
            </View>
            <Text style={styles.plainNote}>
              {(() => {
                const v = usd?.rsi?.value;
                const now =
                  v == null ? '' : v >= ob ? ' Right now it has risen fast.' : v <= os ? ' Right now it has fallen fast.' : ' Right now it is in the normal middle zone.';
                return `How fast the price has been rising or falling. Top band (above ${ob}): risen fast. Bottom band (below ${os}): fallen fast.${now}`;
              })()}
            </Text>
            <RsiLine values={rsiValues.slice(-60)} overbought={ob} oversold={os} width={screenWidth - 64} />
          </GlassCard>
        )}

        {macdHist.length > 0 && (
          <GlassCard>
            <View style={styles.labelRow}>
              <Text style={styles.sectionLabel}>MACD</Text>
              <InfoButton term="macd" />
            </View>
            {/* The plain sentence first: most people need only that. */}
            <Text style={styles.plainLead}>
              {(() => {
                const last = macdHist[macdHist.length - 1] ?? 0;
                const prev = macdHist[macdHist.length - 2] ?? 0;
                const dir = last >= 0 ? 'an upward' : 'a downward';
                const trend = Math.abs(last) >= Math.abs(prev) ? 'getting stronger' : 'fading';
                return `Right now the price has ${dir} push that is ${trend}.`;
              })()}
            </Text>
            <View style={styles.miniChart}>
              <View style={styles.miniChartBg}>
                <View style={[styles.midLine, { bottom: '50%' }]} />
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
                          left: `${(i / (arr.length - 1 || 1)) * 97}%`,
                          bottom: v >= 0 ? '50%' : `${50 - halfPct}%`,
                          width: 4,
                          height: `${halfPct}%`,
                          backgroundColor: v >= 0 ? Colors.bullish : Colors.bearish,
                        }}
                      />
                    );
                  });
                })()}
              </View>
            </View>
            <Text style={styles.plainNote}>Green bars: an upward push. Red bars: a downward push. Taller bars: a stronger push.</Text>
          </GlassCard>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/** RSI as a line, with the overbought and oversold bands shaded and labelled. */
const RsiLine = ({ values, overbought, oversold, width }: { values: number[]; overbought: number; oversold: number; width: number }) => {
  const H = 90;
  const W = Math.max(100, width - 26);
  const y = (v: number) => ((100 - Math.max(0, Math.min(100, v))) / 100) * H;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * W;
  const last = values[values.length - 1] ?? 50;
  const colour = last >= overbought ? Colors.bearish : last <= oversold ? Colors.bullish : Colors.accent;
  return (
    <Svg width={W + 26} height={H + 4} style={{ marginTop: Spacing.sm }}>
      <Rect x={0} y={0} width={W} height={y(overbought)} fill={Colors.bearish} fillOpacity={0.1} />
      <Rect x={0} y={y(oversold)} width={W} height={H - y(oversold)} fill={Colors.bullish} fillOpacity={0.1} />
      {[overbought, 50, oversold].map((v) => (
        <React.Fragment key={v}>
          <Line x1={0} x2={W} y1={y(v)} y2={y(v)} stroke={Colors.textTertiary} strokeOpacity={v === 50 ? 0.25 : 0.5} strokeDasharray={v === 50 ? '2 4' : undefined} />
          <SvgText fontFamily={Fonts.system} x={W + 4} y={y(v) + 3.5} fill={Colors.textTertiary} fontSize={10}>{String(v)}</SvgText>
        </React.Fragment>
      ))}
      <Polyline points={values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} fill="none" stroke={Colors.accent} strokeWidth={1.8} />
      <Rect x={x(values.length - 1) - 3} y={y(last) - 3} width={6} height={6} rx={3} fill={colour} />
    </Svg>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  headerTitle: { ...Typography.heading },
  headerSub: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.md },
  tfRow: { flexDirection: 'row', gap: Spacing.sm },
  tfPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: BorderRadius.pill, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  tfPillActive: { backgroundColor: Colors.accent + '22', borderColor: Colors.accent },
  tfText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600' },
  tfTextActive: { color: Colors.accent },
  tfNotice: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 17 },
  chartCard: { padding: Spacing.sm },
  loadingBox: { height: 316, alignItems: 'center', justifyContent: 'center' },
  noData: { ...Typography.body, color: Colors.textTertiary },
  overlayRow: { flexGrow: 0 },
  overlayChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: BorderRadius.pill, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, borderWidth: 1, borderColor: Colors.cardBorder },
  overlayDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  overlayLabel: { ...Typography.caption, color: Colors.textSecondary },
  sectionLabel: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  valueRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  ovLabel: { ...Typography.caption, fontWeight: '600' },
  ovVal: { ...Typography.monoData },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  plainNote: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18, marginTop: Spacing.xs },
  plainLead: { ...Typography.body, color: Colors.textPrimary, lineHeight: 22, marginTop: Spacing.sm },
  miniChart: { height: 70, marginTop: Spacing.sm },
  miniChartBg: { flex: 1, position: 'relative', backgroundColor: Colors.elevated, borderRadius: 4, overflow: 'hidden' },
  midLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Colors.textTertiary, opacity: 0.3 },
});
