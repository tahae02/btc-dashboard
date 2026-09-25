import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from './GlassCard';
import { useJournal } from '../context/JournalContext';
import { useTrackRecord } from '../hooks/useTrackRecord';
import { ACTION_LABEL } from '../services/signalEngine';
import { SCORE_HORIZONS, type TrackRecord, type HorizonStats } from '../services/trackRecord';
import { formatPct, formatMoney, formatDate, isFlat } from '../services/format';
import { Colors, Typography, Spacing, BorderRadius, getSignalColor, Fonts } from '../constants/theme';

/** Below this many non-overlapping 30-day periods a tier's numbers are noise. */
const MIN_PERIODS = 3;

const pctCell = (h: HorizonStats) => (h.mean == null ? '…' : formatPct(h.mean));
const colour = (h: HorizonStats) =>
  h.mean == null ? Colors.textTertiary : isFlat(h.mean) ? Colors.textSecondary : h.mean > 0 ? Colors.bullish : Colors.bearish;

const Table = ({ record }: { record: TrackRecord }) => (
  <View>
    <View style={styles.tableHead}>
      <Text style={[styles.th, styles.colSignal]}>Signal</Text>
      <Text style={[styles.th, styles.colDays]}>Days</Text>
      {SCORE_HORIZONS.map((h) => (
        <Text key={h} style={[styles.th, styles.colNum]}>{h}d later</Text>
      ))}
    </View>
    {record.tiers.map((t) => {
      const thin = t.independentPeriods < MIN_PERIODS;
      return (
        <View key={t.action} style={[styles.tr, thin && styles.thin]}>
          <Text style={[styles.td, styles.colSignal, { color: getSignalColor(t.action), fontWeight: '700' }]} numberOfLines={1}>
            {ACTION_LABEL[t.action]}
          </Text>
          <Text style={[styles.td, styles.colDays]}>{t.days}</Text>
          {SCORE_HORIZONS.map((h) => (
            <Text key={h} style={[styles.td, styles.colNum, { color: colour(t.byHorizon[h]) }]}>{pctCell(t.byHorizon[h])}</Text>
          ))}
        </View>
      );
    })}
    <View style={[styles.tr, styles.baseRow]}>
      <Text style={[styles.td, styles.colSignal, { color: Colors.textSecondary }]}>Any day</Text>
      <Text style={[styles.td, styles.colDays]}>{record.days}</Text>
      {SCORE_HORIZONS.map((h) => (
        <Text key={h} style={[styles.td, styles.colNum, { color: colour(record.baseline[h]) }]}>{pctCell(record.baseline[h])}</Text>
      ))}
    </View>
  </View>
);

/** One plain sentence on the headline comparison, or an honest "too early". */
const headline = (r: TrackRecord): string => {
  const top = r.tiers.find((t) => t.action === 'ACCUMULATE_STRONG' || t.action === 'ACCUMULATE');
  const base = r.baseline[30].mean;
  if (!top || top.independentPeriods < MIN_PERIODS || top.byHorizon[30].mean == null || base == null) {
    return 'Too few independent periods yet to say whether the buy signals beat an average day.';
  }
  const diff = top.byHorizon[30].mean - base;
  return (
    `After ${ACTION_LABEL[top.action]} days, BTC moved ${formatPct(top.byHorizon[30].mean)} over the next 30 days on average, ` +
    `against ${formatPct(base)} for any day: ${diff >= 0 ? 'better' : 'worse'} by ${Math.abs(diff * 100).toFixed(1)} points.`
  );
};

const rangeLine = (label: string, rate: number | null) =>
  rate == null ? null : `${label}: price finished inside it on ${Math.round(rate * 100)}% of days (it says about two thirds).`;

export const TrackRecordCard = () => {
  const journal = useJournal();
  const { replay, live, progress } = useTrackRecord(journal.closedDaily, journal.config, journal.signalLog);
  const [whyOpen, setWhyOpen] = useState(false);

  const enoughHistory = journal.closedDaily.length > 250;

  return (
    <GlassCard>
      <Text style={styles.title}>Track record</Text>

      {!enoughHistory ? (
        <Text style={styles.body}>Waiting for daily price history to load.</Text>
      ) : !replay ? (
        <View>
          <Text style={styles.body}>Replaying the engine over past days…</Text>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        </View>
      ) : (
        <>
          <Text style={styles.body}>
            The engine replayed on each day from {replay.from ? formatDate(replay.from) : '--'} to{' '}
            {replay.to ? formatDate(replay.to) : '--'}, seeing only prices up to that day, and what BTC did next.
          </Text>
          <Table record={replay} />
          <Text style={styles.reading}>{headline(replay)}</Text>

          {replay.dca && (
            <Text style={styles.reading}>
              Buying weekly and scaling each buy by the DCA multiplier paid an average of{' '}
              {formatMoney(replay.dca.signalAvgCost, 'USD')} per BTC; a flat weekly amount paid{' '}
              {formatMoney(replay.dca.flatAvgCost, 'USD')}. Following the multiplier bought{' '}
              <Text style={{ color: replay.dca.advantagePct >= 0 ? Colors.bullish : Colors.bearish, fontWeight: '700' }}>
                {Math.abs(replay.dca.advantagePct).toFixed(1)}% {replay.dca.advantagePct >= 0 ? 'cheaper' : 'dearer'}
              </Text>
              , over {replay.dca.weeks} weeks.
            </Text>
          )}

          {[rangeLine('24h range', replay.range1d.rate), rangeLine('7d range', replay.range7d.rate)]
            .filter(Boolean)
            .map((line) => (
              <Text key={line!} style={styles.reading}>{line}</Text>
            ))}
        </>
      )}

      <View style={styles.divider} />
      <Text style={styles.subtitle}>Recorded on this phone</Text>
      {!live || journal.signalLog.length === 0 ? (
        <Text style={styles.body}>
          Each day you open the app, the signal it shows you is saved here. This is the honest record: calls made
          without hindsight, scored as the days pass.
        </Text>
      ) : (
        <>
          <Text style={styles.body}>
            {journal.signalLog.length} day{journal.signalLog.length === 1 ? '' : 's'} recorded since{' '}
            {formatDate(journal.signalLog[0]!.day + 86400000)}.
            {live.baseline[7].n === 0 ? ' Results appear as 7, 30 and 90 days pass.' : ''}
          </Text>
          {live.baseline[7].n > 0 && <Table record={live} />}
        </>
      )}

      <Text style={styles.caveat}>
        Dimmed rows cover fewer than {MIN_PERIODS} separate 30-day periods, which is too few to judge. Consecutive days
        overlap, so {replay ? Math.floor(replay.days / 30) : 'N'} independent months is the real sample, not the day count.
        Replayed days leave out Fear &amp; Greed, which has no history here.
      </Text>

      <Pressable onPress={() => setWhyOpen((o) => !o)} style={styles.whyRow} accessibilityRole="button">
        <Text style={styles.whyTitle}>Why doesn't the engine tune itself from this?</Text>
        <Ionicons name={whyOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.accent} />
      </Pressable>
      {whyOpen && (
        <Text style={styles.body}>
          Because with this little data it would learn the noise, not the market. A month's BTC move is routinely ±20%,
          so telling a real edge from luck takes many independent periods, and two years gives fewer than two dozen. An
          engine that retuned itself on that would chase whatever happened to work recently, look like it was improving,
          and get worse. The right place to test a change is the backtester, which runs the engine over a decade or more
          of real price history with a separate out-of-sample check. A change is worth keeping only if it holds up there.
          This record is how you spot when it is worth trying one.
        </Text>
      )}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  title: { ...Typography.subheading, marginBottom: Spacing.sm },
  subtitle: { ...Typography.body, fontWeight: '600', marginBottom: Spacing.sm },
  body: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18, marginBottom: Spacing.sm },
  reading: { ...Typography.caption, color: Colors.textPrimary, lineHeight: 18, marginTop: Spacing.sm },
  caveat: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, marginTop: Spacing.md },
  bar: { height: 6, backgroundColor: Colors.elevated, borderRadius: 3, overflow: 'hidden', marginTop: Spacing.xs },
  barFill: { height: '100%', backgroundColor: Colors.accent },
  divider: { height: 1, backgroundColor: Colors.cardBorder, marginVertical: Spacing.lg },
  tableHead: { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder },
  tr: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder },
  thin: { opacity: 0.45 },
  baseRow: { borderBottomWidth: 0 },
  th: { ...Typography.caption, color: Colors.textTertiary, fontSize: 10 },
  td: { ...Typography.caption, color: Colors.textPrimary, fontFamily: Fonts.mono, fontSize: 11 },
  colSignal: { flex: 1.7 },
  colDays: { flex: 0.6, textAlign: 'right' },
  colNum: { flex: 1, textAlign: 'right' },
  whyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md, paddingVertical: 4 },
  whyTitle: { ...Typography.caption, color: Colors.accent, fontWeight: '600', flex: 1 },
});
