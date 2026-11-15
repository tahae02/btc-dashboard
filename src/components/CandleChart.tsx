import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, Pressable } from 'react-native';
import Svg, { Line, Rect, Polyline, Path, Circle, Text as SvgText } from 'react-native-svg';
import {
  buildChartWindow, priceScale, formatAxisPrice, formatCandleTime, dateLabelIndexes, candleIndexAt,
  candleIsUp, clampOffset, visibleCandleCount,
} from '../services/chartWindow';
import { TIMEFRAME_MS } from '../services/candles';
import { formatMoney, formatDate, formatDateTime, formatPct } from '../services/format';
import { Colors, Typography, Spacing, BorderRadius, Fonts } from '../constants/theme';
import type { Currency, OHLCVCandle, Timeframe } from '../types';

export interface ChartOverlay {
  key: string;
  /** Index-aligned to the full candle series, NaN during warm-up. */
  values: number[] | null | undefined;
  color: string;
}

export interface ChartMarker {
  time: number;
  /** Price per BTC paid or received, in the chart's currency. */
  price: number;
  side: 'buy' | 'sell';
}

interface Props {
  candles: OHLCVCandle[];
  timeframe: Timeframe;
  currency: Currency;
  width: number;
  height?: number;
  overlays?: ChartOverlay[];
  /** Fill between two overlays (a Bollinger pair). */
  band?: { upper: string; lower: string; color: string } | null;
  markers?: ChartMarker[];
  /** Your average cost per BTC, in the chart's currency. */
  averageCost?: number | null;
  /** Called with true while a finger drags the chart sideways, so the page can stop scrolling. */
  onDragChange?: (dragging: boolean) => void;
}

const AXIS_W = 46;
const TOP = 8;
const DATE_H = 18;
const CANDLE_SLOT = 8;

/**
 * Candlestick chart drawn straight in SVG. Green candles closed higher than
 * they opened; red ones closed lower. Drag sideways to go back in time; tap a
 * candle for its prices. Only a screen's width of candles is ever drawn (see
 * src/services/chartWindow.ts for why).
 */
export const CandleChart = ({
  candles, timeframe, currency, width, height = 280, overlays = [], band = null, markers = [], averageCost = null, onDragChange,
}: Props) => {
  const plotW = Math.max(100, width - AXIS_W);
  const plotH = height - TOP - DATE_H;
  const count = visibleCandleCount(plotW, CANDLE_SLOT, 0, 30, 90);
  const slot = plotW / count;
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const lineRecord = useMemo(() => Object.fromEntries(overlays.map((o) => [o.key, o.values])), [overlays]);
  const win = useMemo(() => buildChartWindow(candles, count, lineRecord, offset), [candles, count, lineRecord, offset]);
  const interval = TIMEFRAME_MS[timeframe];

  const visibleMarkers = useMemo(
    () =>
      markers
        .map((m) => ({ ...m, index: candleIndexAt(win.candles, m.time, interval) }))
        .filter((m) => m.index >= 0 && m.price > 0),
    [markers, win.candles, interval]
  );

  // The scale covers the candles, the lines and your buys. Your average cost
  // is drawn only when it sits near enough not to squash the candles;
  // otherwise it gets a label at the edge pointing the right way.
  let lo = win.lo;
  let hi = win.hi;
  for (const m of visibleMarkers) { lo = Math.min(lo, m.price); hi = Math.max(hi, m.price); }
  const span = Math.max(1, hi - lo);
  const avgInView = averageCost != null && averageCost > 0 && averageCost >= lo - span * 0.25 && averageCost <= hi + span * 0.25;
  if (avgInView) { lo = Math.min(lo, averageCost!); hi = Math.max(hi, averageCost!); }
  const scale = priceScale(lo, hi, 4);
  const y = (v: number) => TOP + ((scale.max - v) / (scale.max - scale.min)) * plotH;
  const x = (i: number) => i * slot + slot / 2;

  // Gestures: a sideways drag moves through history; a tap picks a candle.
  // Vertical movement is left to the page, so scrolling past the chart works.
  const live = useRef({ offset, n: candles.length, count, slot, onDragChange, startOffset: 0, dragging: false });
  live.current = { ...live.current, offset, n: candles.length, count, slot, onDragChange };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => !live.current.dragging,
        onPanResponderGrant: () => {
          live.current.startOffset = live.current.offset;
          live.current.dragging = false;
        },
        onPanResponderMove: (_, g) => {
          const L = live.current;
          if (!L.dragging && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy)) {
            L.dragging = true;
            L.onDragChange?.(true);
            setSelected(null);
          }
          if (L.dragging) setOffset(clampOffset(L.n, L.count, L.startOffset + g.dx / L.slot));
        },
        onPanResponderRelease: (e, g) => {
          const L = live.current;
          if (!L.dragging && Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) {
            const i = Math.floor(e.nativeEvent.locationX / L.slot);
            setSelected((s) => (s === i ? null : i));
          }
          if (L.dragging) L.onDragChange?.(false);
          L.dragging = false;
        },
        onPanResponderTerminate: () => {
          if (live.current.dragging) live.current.onDragChange?.(false);
          live.current.dragging = false;
        },
      }),
    []
  );

  const pick = selected != null ? win.candles[selected] : undefined;
  const last = win.candles[win.candles.length - 1];
  const bandPath = (() => {
    if (!band) return null;
    const up = win.lines.find((l) => l.key === band.upper);
    const dn = win.lines.find((l) => l.key === band.lower);
    if (!up || !dn) return null;
    const top = up.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const bottom = dn.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse();
    return `M ${top.join(' L ')} L ${bottom.join(' L ')} Z`;
  })();

  return (
    <View>
      <View style={styles.infoBox}>
        {pick ? (
          <>
            <Text style={styles.infoStrong} numberOfLines={1}>
              {timeframe === '1D' || timeframe === '1W' ? formatDate(pick.time) : formatDateTime(pick.time)}
              {'  ·  '}Close {formatMoney(pick.close, currency)}
              {'  '}
              <Text style={{ color: candleIsUp(pick) ? Colors.bullish : Colors.bearish }}>
                {formatPct(pick.open > 0 ? pick.close / pick.open - 1 : 0)}
              </Text>
            </Text>
            <Text style={styles.info} numberOfLines={1}>
              Open {formatMoney(pick.open, currency)}   High {formatMoney(pick.high, currency)}   Low {formatMoney(pick.low, currency)}
            </Text>
          </>
        ) : (
          <Text style={styles.info}>Drag sideways to go back in time. Tap a candle for its prices.</Text>
        )}
      </View>
      <View {...pan.panHandlers}>
        <Svg width={width} height={height}>
          {scale.ticks.map((t) => (
            <React.Fragment key={t}>
              <Line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={Colors.cardBorder} strokeWidth={1} />
              <SvgText fontFamily={Fonts.system} x={plotW + 4} y={y(t) + 3.5} fill={Colors.textTertiary} fontSize={10}>
                {formatAxisPrice(t, scale.step, currency)}
              </SvgText>
            </React.Fragment>
          ))}

          {bandPath && <Path d={bandPath} fill={band!.color} fillOpacity={0.08} stroke="none" />}

          {pick && <Rect x={selected! * slot} y={TOP} width={slot} height={plotH} fill={Colors.textPrimary} fillOpacity={0.07} />}

          {win.candles.map((c, i) => {
            const up = candleIsUp(c);
            const colour = up ? Colors.bullish : Colors.bearish;
            const bodyTop = y(Math.max(c.open, c.close));
            const bodyH = Math.max(1, y(Math.min(c.open, c.close)) - bodyTop);
            const bodyW = Math.max(1.5, slot * 0.66);
            return (
              <React.Fragment key={c.time}>
                <Line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={colour} strokeWidth={1} />
                <Rect x={x(i) - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={colour} />
              </React.Fragment>
            );
          })}

          {win.lines.map((l) => {
            const colour = overlays.find((o) => o.key === l.key)?.color ?? Colors.accent;
            return (
              <Polyline
                key={l.key}
                points={l.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
                fill="none"
                stroke={colour}
                strokeWidth={1.5}
              />
            );
          })}

          {avgInView && (
            <>
              <Line x1={0} x2={plotW} y1={y(averageCost!)} y2={y(averageCost!)} stroke={Colors.accent} strokeWidth={1} strokeDasharray="4 3" />
              {/* A backing so the label reads clearly over candles. */}
              <Rect
                x={0}
                y={y(averageCost!) - 15}
                width={(`Your average ${formatAxisPrice(averageCost!, scale.step / 10, currency)}`.length * 5.6) + 8}
                height={13}
                rx={3}
                fill={Colors.card}
                fillOpacity={0.85}
              />
              <SvgText fontFamily={Fonts.system} x={4} y={y(averageCost!) - 5} fill={Colors.accent} fontSize={10} fontWeight="600">
                {`Your average ${formatAxisPrice(averageCost!, scale.step / 10, currency)}`}
              </SvgText>
            </>
          )}
          {!avgInView && averageCost != null && averageCost > 0 && (
            <SvgText fontFamily={Fonts.system} x={4} y={averageCost > scale.max ? TOP + 11 : TOP + plotH - 4} fill={Colors.accent} fontSize={10} fontWeight="600">
              {`Your average ${formatAxisPrice(averageCost, scale.step / 10, currency)} ${averageCost > scale.max ? '↑' : '↓'}`}
            </SvgText>
          )}

          {visibleMarkers.map((m, k) => (
            <Circle
              key={`${m.time}-${k}`}
              cx={x(m.index)}
              cy={y(m.price)}
              r={4.5}
              fill={m.side === 'buy' ? Colors.accent : Colors.neutral}
              stroke={Colors.background}
              strokeWidth={1.5}
            />
          ))}

          {last && win.offset === 0 && (
            <Line x1={0} x2={plotW} y1={y(last.close)} y2={y(last.close)} stroke={candleIsUp(last) ? Colors.bullish : Colors.bearish} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 3" />
          )}

          {dateLabelIndexes(win.candles.length, plotW < 300 ? 3 : 4).map((i) => (
            <SvgText fontFamily={Fonts.system} key={i} x={x(i)} y={height - 4} fill={Colors.textTertiary} fontSize={10} textAnchor="middle">
              {formatCandleTime(win.candles[i]!.time, timeframe)}
            </SvgText>
          ))}
        </Svg>
      </View>
      {win.offset > 0 && (
        <Pressable onPress={() => setOffset(0)} style={styles.latest} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.latestText}>Back to latest ›</Text>
        </Pressable>
      )}
      {visibleMarkers.length > 0 || averageCost ? (
        <View style={styles.legend}>
          <View style={[styles.dot, { backgroundColor: Colors.accent }]} />
          <Text style={styles.legendText}>Your buys</Text>
          {markers.some((m) => m.side === 'sell') && (
            <>
              <View style={[styles.dot, { backgroundColor: Colors.neutral }]} />
              <Text style={styles.legendText}>Your sells</Text>
            </>
          )}
          {averageCost ? <Text style={styles.legendText}>  - - Your average cost</Text> : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  infoBox: { minHeight: 36, marginBottom: Spacing.xs, justifyContent: 'center' },
  info: { ...Typography.caption, color: Colors.textSecondary, fontVariant: ['tabular-nums'] },
  infoStrong: { ...Typography.caption, color: Colors.textPrimary, fontWeight: '600', fontVariant: ['tabular-nums'] },
  latest: {
    position: 'absolute', right: AXIS_W + 4, top: 44, backgroundColor: Colors.elevated, borderRadius: BorderRadius.pill,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  latestText: { ...Typography.caption, color: Colors.accent, fontWeight: '600' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs, flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...Typography.caption, color: Colors.textSecondary, marginRight: 6 },
});
