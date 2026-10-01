import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, type LayoutChangeEvent } from 'react-native';
import type { Currency } from '../types';
import { positionForPrice, priceAtPosition, nudgePrice, shortPrice, SCALE_TICKS } from '../services/calculator';
import { formatMoney } from '../services/format';
import { Colors, Typography } from '../constants/theme';

const THUMB = 28;
const LABEL_W = 48;

interface Props {
  value: number;
  currency: Currency;
  /** Today's price, marked on the track. */
  today: number | null;
  onChange: (price: number) => void;
  /** So the screen can stop scrolling while a finger is on the slider. */
  onDragChange?: (dragging: boolean) => void;
}

/**
 * A log-scale price slider, built on PanResponder so it needs no native
 * module and behaves the same in the APK and the web build.
 */
export const PriceSlider = ({ value, currency, today, onChange, onDragChange }: Props) => {
  const [width, setWidth] = useState(0);
  const usable = Math.max(1, width - THUMB);
  // The responder is created once, so it reads the latest props through refs.
  const live = useRef({ usable, onChange, onDragChange, last: value });
  live.current = { ...live.current, usable, onChange, onDragChange };
  const startX = useRef(0);

  const responder = useMemo(() => {
    const emit = (x: number) => {
      const price = priceAtPosition((x - THUMB / 2) / live.current.usable);
      if (price !== live.current.last) {
        live.current.last = price;
        live.current.onChange(price);
      }
    };
    const end = () => live.current.onDragChange?.(false);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        live.current.onDragChange?.(true);
        startX.current = e.nativeEvent.locationX;
        emit(startX.current);
      },
      onPanResponderMove: (_, g) => emit(startX.current + g.dx),
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
  }, []);
  live.current.last = value;

  const at = (price: number) => THUMB / 2 + positionForPrice(price) * usable;
  const thumbX = at(value);

  return (
    <View>
      <View
        style={styles.touch}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Bitcoin price"
        accessibilityValue={{ text: formatMoney(value, currency) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(nudgePrice(value, e.nativeEvent.actionName === 'increment' ? 1 : -1))}
        {...responder.panHandlers}
      >
        {/* Children ignore touches so locationX is always measured from the track's left edge. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={[styles.track, { left: THUMB / 2, right: THUMB / 2 }]} />
          {width > 0 && (
            <>
              <View style={[styles.fill, { left: THUMB / 2, width: Math.max(0, thumbX - THUMB / 2) }]} />
              {SCALE_TICKS.map((p) => (
                <View key={p} style={[styles.tick, { left: at(p) - 1 }]} />
              ))}
              {today != null && today > 0 && <View style={[styles.today, { left: at(today) - 1.5 }]} />}
              <View style={[styles.thumb, { left: thumbX - THUMB / 2 }]} />
            </>
          )}
        </View>
      </View>
      {width > 0 && (
        <View style={styles.labels} pointerEvents="none">
          {SCALE_TICKS.map((p) => {
            const left = Math.min(width - LABEL_W, Math.max(0, at(p) - LABEL_W / 2));
            const align = left === 0 ? 'left' : left === width - LABEL_W ? 'right' : 'center';
            return (
              <Text key={p} style={[styles.label, { left, textAlign: align }]}>
                {shortPrice(p, currency)}
              </Text>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  touch: { height: 44, justifyContent: 'center' },
  track: { position: 'absolute', top: 20, height: 4, borderRadius: 2, backgroundColor: Colors.elevated },
  fill: { position: 'absolute', top: 20, height: 4, borderRadius: 2, backgroundColor: Colors.accent },
  tick: { position: 'absolute', top: 16, width: 2, height: 12, borderRadius: 1, backgroundColor: Colors.cardBorder },
  today: { position: 'absolute', top: 10, width: 3, height: 24, borderRadius: 1.5, backgroundColor: Colors.neutral },
  thumb: {
    position: 'absolute', top: 8, width: THUMB, height: THUMB, borderRadius: THUMB / 2,
    backgroundColor: Colors.textPrimary, borderWidth: 3, borderColor: Colors.accent,
  },
  labels: { height: 16, marginTop: 2 },
  label: { ...Typography.caption, position: 'absolute', width: LABEL_W, fontSize: 10, color: Colors.textTertiary },
});
