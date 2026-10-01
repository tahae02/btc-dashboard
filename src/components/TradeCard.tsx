import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from './GlassCard';
import { tradeOutcomes, type Trade, type PriceSeries } from '../services/journal';
import { ACTION_LABEL } from '../services/signalEngine';
import { formatMoney, formatBtc, formatPct, formatDateTime, isFlat } from '../services/format';
import { Colors, Typography, Spacing, BorderRadius, getSignalColor } from '../constants/theme';

/** Colour for a fractional move: neutral when it rounds to 0.0%. */
const moveColour = (n: number | null | undefined, good: boolean | null = n == null ? null : n > 0) =>
  n == null || isFlat(n) ? Colors.textSecondary : good ? Colors.bullish : Colors.bearish;

const daysUntil = (t: number) => Math.max(1, Math.ceil((t - Date.now()) / 86400000));

interface Props {
  trade: Trade;
  series: PriceSeries[];
  /** Already counted in the starting balance. Real trades only. */
  covered?: boolean;
  onPress: () => void;
  onDelete: () => void;
  /** Set for a paper trade: it gets a PAPER badge, and these lines under the order. */
  paperLines?: string[];
}

/** One trade in a list, real or paper: the order, the signal then, and what the price did after. */
export const TradeCard = ({ trade: t, series, covered = false, onPress, onDelete, paperLines }: Props) => {
  const outcomes = tradeOutcomes(t, series);
  const paper = paperLines != null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={paper ? 'Open paper trade details' : 'Open trade details'}>
      <GlassCard style={[styles.card, paper && styles.paperCard]}>
        <View style={styles.top}>
          <View style={styles.topLeft}>
            <View style={[styles.pill, { backgroundColor: (t.side === 'buy' ? Colors.bullish : Colors.bearish) + '26' }]}>
              <Text style={[styles.pillText, { color: t.side === 'buy' ? Colors.bullish : Colors.bearish }]}>{t.side.toUpperCase()}</Text>
            </View>
            {paper && (
              <View style={[styles.pill, { backgroundColor: Colors.paper + '26' }]}>
                <Text style={[styles.pillText, { color: Colors.paper }]}>PAPER</Text>
              </View>
            )}
            <Text style={styles.date}>{formatDateTime(t.time)}</Text>
          </View>
          <Pressable onPress={onDelete} hitSlop={10} accessibilityLabel={paper ? 'Delete paper trade' : 'Delete trade'}>
            <Ionicons name="trash-outline" size={18} color={Colors.textTertiary} />
          </Pressable>
        </View>

        <Text style={styles.main}>
          {formatMoney(t.fiat, t.currency)} {t.side === 'buy' ? '→' : '←'} {formatBtc(t.btc)} BTC
        </Text>
        <Text style={styles.sub}>
          at {formatMoney(t.unitPrice ?? t.fiat / t.btc, t.currency)} per BTC
          {t.fee > 0 ? ` · fee ${formatMoney(t.fee, t.currency)}` : ''}
        </Text>
        {paperLines?.map((line) => (
          <Text key={line} style={styles.paperLine}>{line}</Text>
        ))}
        {covered && <Text style={styles.covered}>Already counted in your starting balance, so not added again.</Text>}

        {t.signal ? (
          <View style={styles.stampRow}>
            <Text style={[styles.stampAction, { color: getSignalColor(t.signal.action) }]}>{ACTION_LABEL[t.signal.action]}</Text>
            <Text style={styles.stampMeta}>
              {' '}· {t.signal.dcaMultiplier}× · conviction {t.signal.conviction}%
              {t.signal.fearGreed != null ? ` · F&G ${t.signal.fearGreed}` : ''}
              {t.signal.source === 'reconstructed' ? ' · replayed' : ''}
            </Text>
          </View>
        ) : (
          <Text style={[styles.stampMeta, { marginTop: Spacing.sm }]}>No signal recorded</Text>
        )}

        <View style={styles.outcomes}>
          {outcomes.map((o) => (
            <View key={o.key} style={styles.outcome}>
              <Text style={styles.outcomeLabel}>{o.key} later</Text>
              {o.change != null ? (
                <Text style={[styles.outcomeValue, { color: moveColour(o.change, o.favourable) }]}>{formatPct(o.change)}</Text>
              ) : (
                <Text style={styles.outcomePending}>{o.due > Date.now() ? `in ${daysUntil(o.due)}d` : '--'}</Text>
              )}
            </View>
          ))}
        </View>
        {t.note ? <Text style={styles.note}>{t.note}</Text> : null}
        <Text style={[styles.hint, paper && { color: Colors.paper }]}>Tap for everything recorded →</Text>
      </GlassCard>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: { paddingVertical: Spacing.md },
  paperCard: { borderColor: Colors.paper + '40' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1 },
  pill: { borderRadius: BorderRadius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { ...Typography.caption, fontWeight: '700', fontSize: 11 },
  date: { ...Typography.caption, flexShrink: 1 },
  main: { ...Typography.monoData, fontSize: 16, marginTop: Spacing.sm },
  sub: { ...Typography.caption, marginTop: 2 },
  paperLine: { ...Typography.caption, color: Colors.textSecondary, marginTop: 4, fontSize: 11, lineHeight: 15 },
  covered: { ...Typography.caption, color: Colors.neutral, marginTop: 4, fontSize: 11 },
  stampRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: Spacing.sm },
  stampAction: { ...Typography.caption, fontWeight: '700' },
  stampMeta: { ...Typography.caption, color: Colors.textTertiary },
  outcomes: { flexDirection: 'row', marginTop: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.cardBorder },
  outcome: { flex: 1, alignItems: 'center' },
  outcomeLabel: { ...Typography.caption, color: Colors.textTertiary, fontSize: 11 },
  outcomeValue: { ...Typography.monoData, fontSize: 13, marginTop: 2 },
  outcomePending: { ...Typography.caption, color: Colors.textTertiary, marginTop: 2 },
  hint: { ...Typography.caption, color: Colors.accent, fontSize: 11, marginTop: Spacing.sm },
  note: { ...Typography.caption, color: Colors.textSecondary, marginTop: Spacing.sm, fontStyle: 'italic' },
});
