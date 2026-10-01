import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { GlassCard } from './GlassCard';
import { InfoButton } from './InfoButton';
import { MIN_CALLS, MIN_GROUP, paperHeadlines, type OutcomeGroup, type PaperScorecard } from '../services/paperReview';
import { formatPct, isFlat } from '../services/format';
import { Colors, Typography, Spacing, BorderRadius, Fonts, getSignalColor } from '../constants/theme';

type GroupBy = 'bySource' | 'byScenario' | 'byTier' | 'byVsApp';
const GROUPINGS: { key: GroupBy; label: string }[] = [
  { key: 'bySource', label: 'Whose call' },
  { key: 'byScenario', label: 'Why then' },
  { key: 'byTier', label: 'Signal then' },
  { key: 'byVsApp', label: 'Against the app' },
];

const moveColour = (n: number | null, good: boolean | null = n == null ? null : n > 0) =>
  n == null || isFlat(n) ? Colors.textTertiary : good ? Colors.bullish : Colors.bearish;
const cell = (n: number | null) => (n == null ? '…' : formatPct(n));

const GroupTable = ({ groups, tiers }: { groups: OutcomeGroup[]; tiers: boolean }) => (
  <View>
    <View style={styles.tableHead}>
      <Text style={[styles.th, styles.colName]}>Paper buys</Text>
      <Text style={[styles.th, styles.colN]}>Buys</Text>
      <Text style={[styles.th, styles.colNum]}>7d later</Text>
      <Text style={[styles.th, styles.colNum]}>30d later</Text>
    </View>
    {groups.map((g) => (
      <View key={g.key} style={[styles.tr, g.buys < MIN_GROUP && styles.thin]}>
        <Text style={[styles.td, styles.colName, tiers && { color: getSignalColor(g.key), fontWeight: '700' }]} numberOfLines={2}>
          {g.label}
        </Text>
        <Text style={[styles.td, styles.colN]}>{g.buys}</Text>
        <Text style={[styles.td, styles.colNum, { color: moveColour(g.after7d.mean) }]}>{cell(g.after7d.mean)}</Text>
        <Text style={[styles.td, styles.colNum, { color: moveColour(g.after30d.mean) }]}>{cell(g.after30d.mean)}</Text>
      </View>
    ))}
  </View>
);

/** How the paper record has turned out, with every figure's sample size on show. */
export const PaperScorecardCard = ({ card }: { card: PaperScorecard }) => {
  const [groupBy, setGroupBy] = useState<GroupBy>('bySource');
  const headlines = paperHeadlines(card);
  const groups = card[groupBy];
  const calls = card.calibration.filter((c) => c.n > 0);

  return (
    <GlassCard style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>How the advice has done</Text>
        <InfoButton term="paperScorecard" />
      </View>
      <Text style={styles.body}>
        {card.decisions} paper decision{card.decisions === 1 ? '' : 's'}: {card.buys} buy{card.buys === 1 ? '' : 's'},{' '}
        {card.sells} sell{card.sells === 1 ? '' : 's'}, {card.skips} not buying, {card.orders.placed} limit order
        {card.orders.placed === 1 ? '' : 's'}.
      </Text>

      {headlines.length ? (
        headlines.map((h) => (
          <Text key={h} style={styles.reading}>{h}</Text>
        ))
      ) : (
        <Text style={styles.body}>Results appear here as the days pass: the first after 24 hours, most after a week or more.</Text>
      )}

      {card.buys > 0 && (
        <>
          <View style={styles.groupChips}>
            {GROUPINGS.map((g) => {
              const on = g.key === groupBy;
              return (
                <Pressable
                  key={g.key}
                  onPress={() => setGroupBy(g.key)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {groups.length ? (
            <GroupTable groups={groups} tiers={groupBy === 'byTier'} />
          ) : (
            <Text style={styles.body}>None of your paper buys has this recorded.</Text>
          )}
        </>
      )}

      {calls.length > 0 && (
        <>
          <Text style={styles.subtitle}>Claude&apos;s chances</Text>
          <View style={styles.tableHead}>
            <Text style={[styles.th, styles.colName]}>Lower after</Text>
            <Text style={[styles.th, styles.colN]}>Calls</Text>
            <Text style={[styles.th, styles.colNum]}>It said</Text>
            <Text style={[styles.th, styles.colNum]}>It was</Text>
            <Text style={[styles.th, styles.colNum]}>Score</Text>
          </View>
          {calls.map((c) => (
            <View key={c.key} style={[styles.tr, c.n < MIN_CALLS && styles.thin]}>
              <Text style={[styles.td, styles.colName]}>{c.label}</Text>
              <Text style={[styles.td, styles.colN]}>{c.n}</Text>
              <Text style={[styles.td, styles.colNum]}>{Math.round((c.meanForecast ?? 0) * 100)}%</Text>
              <Text style={[styles.td, styles.colNum]}>{Math.round((c.lowerRate ?? 0) * 100)}%</Text>
              <Text style={[styles.td, styles.colNum, { color: c.brier != null && c.brier < 0.25 ? Colors.bullish : Colors.textPrimary }]}>
                {c.brier?.toFixed(3)}
              </Text>
            </View>
          ))}
          <Text style={styles.caveat}>
            &quot;It said&quot; is the average chance of a lower price it gave; &quot;it was&quot; is how often the price
            really was lower. A score under 0.250 beats always saying 50%.
          </Text>
        </>
      )}

      {card.verdicts.length > 0 && (
        <>
          <Text style={styles.subtitle}>Claude&apos;s verdicts</Text>
          <View style={styles.tableHead}>
            <Text style={[styles.th, styles.colName]}>Verdict</Text>
            <Text style={[styles.th, styles.colN]}>Calls</Text>
            <Text style={[styles.th, styles.colNum]}>24h later</Text>
            <Text style={[styles.th, styles.colNum]}>7d later</Text>
          </View>
          {card.verdicts.map((v) => {
            // Buying now is borne out by a rise; waiting by a fall.
            const good = (m: number | null) => (m == null || v.verdict === 'SPLIT' ? null : v.verdict === 'WAIT' ? m < 0 : m > 0);
            return (
              <View key={v.verdict} style={[styles.tr, v.n < MIN_GROUP && styles.thin]}>
                <Text style={[styles.td, styles.colName]}>{v.label}</Text>
                <Text style={[styles.td, styles.colN]}>{v.n}</Text>
                <Text style={[styles.td, styles.colNum, { color: good(v.after24h.mean) == null ? Colors.textPrimary : moveColour(v.after24h.mean, good(v.after24h.mean)) }]}>
                  {cell(v.after24h.mean)}
                </Text>
                <Text style={[styles.td, styles.colNum, { color: good(v.after7d.mean) == null ? Colors.textPrimary : moveColour(v.after7d.mean, good(v.after7d.mean)) }]}>
                  {cell(v.after7d.mean)}
                </Text>
              </View>
            );
          })}
          <Text style={styles.caveat}>Green when the price went the way the verdict needed: up after Buy now, down after Wait.</Text>
        </>
      )}

      <Text style={styles.caveat}>
        Moves are Bitcoin&apos;s dollar price from each decision. Dimmed rows have fewer than {MIN_GROUP} buys (or{' '}
        {MIN_CALLS} calls), which is mostly luck. The app never retunes itself from this; it shows where a change might
        be worth testing.
      </Text>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  card: { borderColor: Colors.paper + '40' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.sm },
  title: { ...Typography.subheading },
  subtitle: { ...Typography.body, fontWeight: '600', marginTop: Spacing.lg, marginBottom: Spacing.xs },
  body: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18, marginBottom: Spacing.sm },
  reading: { ...Typography.caption, color: Colors.textPrimary, lineHeight: 18, marginBottom: Spacing.sm },
  caveat: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, marginTop: Spacing.md },
  groupChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.cardBorder },
  chipOn: { borderColor: Colors.paper, backgroundColor: Colors.paper + '26' },
  chipText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600', fontSize: 11 },
  chipTextOn: { color: Colors.paper },
  tableHead: { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder },
  tr: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder, alignItems: 'center' },
  thin: { opacity: 0.45 },
  th: { ...Typography.caption, color: Colors.textTertiary, fontSize: 10 },
  td: { ...Typography.caption, color: Colors.textPrimary, fontFamily: Fonts.mono, fontSize: 11 },
  colName: { flex: 1.8 },
  colN: { flex: 0.6, textAlign: 'right' },
  colNum: { flex: 1, textAlign: 'right' },
});
