import React, { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Share, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../src/context/DataContext';
import { useJournal } from '../../src/context/JournalContext';
import { GlassCard } from '../../src/components/GlassCard';
import { AddTradeSheet } from '../../src/components/AddTradeSheet';
import { OpeningSheet } from '../../src/components/OpeningSheet';
import { TradeDetailSheet } from '../../src/components/TradeDetailSheet';
import { PriceCalculatorCard } from '../../src/components/PriceCalculatorCard';
import { TradeCard } from '../../src/components/TradeCard';
import { PaperPortfolio } from '../../src/components/PaperPortfolio';
import { InfoButton } from '../../src/components/InfoButton';
import { useExplain } from '../../src/context/ExplainContext';
import { PORTFOLIO_VIEW_KEY } from '../../src/services/paper';
import {
  summariseHoldings, groupBuysBySignal, serialiseBackup, tradesToCsv, isCoveredByOpening,
  type Trade, type TradeSide, type PriceSeries,
} from '../../src/services/journal';
import { ACTION_LABEL } from '../../src/services/signalEngine';
import { TIMEFRAME_MS } from '../../src/services/candles';
import { formatMoney, formatBtc, formatPct, formatDateTime, isFlat } from '../../src/services/format';
import { Colors, Typography, Spacing, BorderRadius, getSignalColor, Fonts } from '../../src/constants/theme';

const pnlColour = (n: number | null | undefined) => (n == null || n === 0 ? Colors.textSecondary : n > 0 ? Colors.bullish : Colors.bearish);
/** Colour for a fractional move: neutral when it rounds to 0.0%. */
const moveColour = (n: number | null | undefined, good: boolean | null = n == null ? null : n > 0) =>
  n == null || isFlat(n) ? Colors.textSecondary : good ? Colors.bullish : Colors.bearish;

type PortfolioView = 'real' | 'paper';

export default function PortfolioScreen() {
  const data = useData();
  const journal = useJournal();
  const { explain } = useExplain();
  const [sheet, setSheet] = useState<TradeSide | null>(null);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreText, setRestoreText] = useState('');
  // Off while a finger is on the calculator's slider, so dragging it does not scroll the page.
  const [scrollable, setScrollable] = useState(true);
  // Real trades or paper trades. Remembered, so the tab opens on whichever was used last.
  const [view, setView] = useState<PortfolioView>('real');
  useEffect(() => {
    AsyncStorage.getItem(PORTFOLIO_VIEW_KEY).then((v) => { if (v === 'paper') setView('paper'); }).catch(() => {});
  }, []);
  const switchView = (v: PortfolioView) => {
    setView(v);
    AsyncStorage.setItem(PORTFOLIO_VIEW_KEY, v).catch(() => {});
  };

  // Hourly bars make the 1-day outcome of a recent trade accurate to the hour.
  const { loadTimeframe } = data;
  const hourly = data.ohlcv['1H'];
  useEffect(() => {
    if (journal.trades.length && !hourly.length) loadTimeframe('1H');
  }, [journal.trades.length, hourly.length, loadTimeframe]);

  const series = useMemo<PriceSeries[]>(
    () => [
      { candles: hourly, intervalMs: TIMEFRAME_MS['1H'] },
      { candles: data.ohlcv['1D'], intervalMs: TIMEFRAME_MS['1D'] },
    ],
    [hourly, data.ohlcv]
  );

  const liveUsd = data.price?.price ?? 0;
  const liveGbp = data.price?.price_gbp ?? 0;
  // Always both currencies, whatever the display setting: pounds are what you
  // pay in, dollars are what the charts are in.
  const gbp = useMemo(
    () => summariseHoldings(journal.trades, 'GBP', { usd: liveUsd, gbp: liveGbp }, journal.opening),
    [journal.trades, liveUsd, liveGbp, journal.opening]
  );
  const usd = useMemo(
    () => summariseHoldings(journal.trades, 'USD', { usd: liveUsd, gbp: liveGbp }, journal.opening),
    [journal.trades, liveUsd, liveGbp, journal.opening]
  );
  const summary = gbp;
  // Which currency the money actually went in, so the note can say which
  // figures are converted at today's rate.
  const used = new Set([...journal.trades.map((t) => t.currency), ...(journal.opening ? [journal.opening.currency] : [])]);
  const groups = useMemo(() => groupBuysBySignal(journal.trades, series), [journal.trades, series]);
  const newestFirst = useMemo(() => [...journal.trades].reverse(), [journal.trades]);

  const detailTrade = detailId ? journal.trades.find((t) => t.id === detailId) ?? null : null;

  const confirmDelete = (t: Trade) => {
    Alert.alert('Delete this trade?', `${t.side === 'buy' ? 'Buy' : 'Sell'} of ${formatMoney(t.fiat, t.currency)} on ${formatDateTime(t.time)}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          journal.deleteTrade(t.id);
          setDetailId(null);
        },
      },
    ]);
  };

  const exportAs = async (kind: 'backup' | 'csv') => {
    const message = kind === 'backup' ? serialiseBackup(journal.trades, journal.opening) : tradesToCsv(journal.trades);
    try {
      await Share.share({ message, title: kind === 'backup' ? 'BTC Analyst backup' : 'BTC Analyst trades (CSV)' });
    } catch { /* user dismissed the share sheet */ }
  };

  const doRestore = () => {
    const r = journal.restore(restoreText);
    if (r.trades === 0 && !r.opening) {
      Alert.alert('Nothing to restore', 'That text does not contain any trades. Paste the whole backup, from the first { to the last }.');
      return;
    }
    Alert.alert(
      'Restored',
      `${r.trades} trade${r.trades === 1 ? '' : 's'} merged in${r.opening ? ', plus your starting balance' : ''}. Trades already here were kept.`
    );
    setRestoreText('');
    setRestoreOpen(false);
  };

  const hasPrice = liveUsd > 0;
  const hasAnything = journal.trades.length > 0 || journal.opening != null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Portfolio</Text>
        <View style={styles.switch} accessibilityRole="tablist">
          {([['real', 'My trades'], ['paper', 'Paper']] as const).map(([v, label]) => {
            const on = view === v;
            const colour = v === 'paper' ? Colors.paper : Colors.accent;
            return (
              <Pressable
                key={v}
                onPress={() => switchView(v)}
                style={[styles.switchBtn, on && { backgroundColor: colour + '26', borderColor: colour }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={v === 'paper' ? 'Paper trading' : 'My real trades'}
              >
                <Text style={[styles.switchText, on && { color: colour }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {view === 'paper' ? (
        <PaperPortfolio />
      ) : (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEnabled={scrollable}>
        {!hasAnything ? (
          <GlassCard>
            <Text style={styles.sectionTitle}>Track what you buy</Text>
            <Text style={styles.body}>
              Log each buy or sell with what you spent and when. The app records what the signal was saying at that
              moment, then shows how the price moved 1, 7, 30 and 90 days later, so you can see how your buys on each
              signal have actually turned out.
            </Text>
            <Text style={[styles.body, { marginTop: Spacing.sm }]}>
              Already own some Bitcoin? Start by adding what you hold and what you have put in, then log new trades
              as you make them. Your trades stay on this phone. Nothing is sent anywhere.
            </Text>
            <Pressable style={[styles.actionBtn, styles.buyBtn, { marginTop: Spacing.lg }]} onPress={() => setOpeningOpen(true)} accessibilityRole="button">
              <Ionicons name="wallet-outline" size={18} color="#000" />
              <Text style={styles.actionTextDark}>Add Bitcoin I already own</Text>
            </Pressable>
          </GlassCard>
        ) : (
          <GlassCard>
            <Text style={styles.label}>Holdings</Text>
            <Text style={styles.btcBig}>{formatBtc(summary.btc)} BTC</Text>
            <View style={styles.pairRow}>
              {([['GBP', gbp], ['USD', usd]] as const).map(([ccy, s]) => (
                <View key={ccy} style={styles.pairCell}>
                  <Text style={styles.valueBig} numberOfLines={1} adjustsFontSizeToFit>
                    {hasPrice ? formatMoney(s.value, ccy) : '--'}
                  </Text>
                  {hasPrice && s.costBasis > 0 && (
                    <Text style={[styles.pnl, { color: pnlColour(s.unrealised) }]} numberOfLines={1} adjustsFontSizeToFit>
                      {formatMoney(s.unrealised, ccy, true)}
                      {s.unrealisedPct != null ? ` (${formatPct(s.unrealisedPct / 100)})` : ''}
                    </Text>
                  )}
                </View>
              ))}
            </View>
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Cost of holdings</Text>
                <Text style={styles.statValue}>{formatMoney(gbp.costBasis, 'GBP')}</Text>
                <Text style={styles.statSub}>{formatMoney(usd.costBasis, 'USD')}</Text>
              </View>
              <View style={styles.stat}>
                <View style={styles.labelRow}>
                  <Text style={styles.statLabel}>Average cost</Text>
                  <InfoButton term="averageCost" />
                </View>
                <Text style={styles.statValue}>{gbp.avgCost != null ? formatMoney(gbp.avgCost, 'GBP') : '--'}</Text>
                <Text style={styles.statSub}>{usd.avgCost != null ? formatMoney(usd.avgCost, 'USD') : '--'}</Text>
              </View>
            </View>
            {summary.sells > 0 && (
              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Realised from sells</Text>
                  <Text style={[styles.statValue, { color: pnlColour(gbp.realised) }]}>{formatMoney(gbp.realised, 'GBP', true)}</Text>
                  <Text style={styles.statSub}>{formatMoney(usd.realised, 'USD', true)}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Total put in</Text>
                  <Text style={styles.statValue}>{formatMoney(gbp.invested, 'GBP')}</Text>
                  <Text style={styles.statSub}>{formatMoney(usd.invested, 'USD')}</Text>
                </View>
              </View>
            )}
            {journal.opening ? (
              <Pressable onPress={() => setOpeningOpen(true)} style={styles.openingRow} accessibilityRole="button">
                <Text style={styles.openingText}>
                  Includes your starting balance: {formatBtc(journal.opening.btc)} BTC for{' '}
                  {formatMoney(journal.opening.invested, journal.opening.currency)}
                </Text>
                <Text style={styles.link}>Edit</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => setOpeningOpen(true)} style={styles.openingRow} accessibilityRole="button">
                <Text style={styles.openingText}>Own Bitcoin from before you started logging?</Text>
                <Text style={styles.link}>Add it</Text>
              </Pressable>
            )}
            {used.size > 0 && (
              <Text style={styles.note}>
                {used.size > 1
                  ? 'You have bought in both pounds and dollars; amounts are converted between them at today\'s exchange rate, so the totals are approximate.'
                  : used.has('GBP')
                  ? 'You bought in pounds. The dollar costs convert what you paid at today\'s exchange rate, not the rate on the day.'
                  : 'You bought in dollars. The pound costs convert what you paid at today\'s exchange rate, not the rate on the day.'}
              </Text>
            )}
            {summary.oversold && (
              <Text style={[styles.note, { color: Colors.neutral }]}>
                More BTC has been sold than was logged as bought. Log the earlier buys for accurate totals.
              </Text>
            )}
          </GlassCard>
        )}

        <View style={styles.actions}>
          <Pressable style={[styles.actionBtn, styles.buyBtn]} onPress={() => setSheet('buy')} accessibilityRole="button">
            <Ionicons name="add" size={18} color="#000" />
            <Text style={styles.actionTextDark}>Log a buy</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, styles.sellBtn]} onPress={() => setSheet('sell')} accessibilityRole="button">
            <Ionicons name="remove" size={18} color={Colors.textPrimary} />
            <Text style={styles.actionText}>Log a sell</Text>
          </Pressable>
        </View>

        <PriceCalculatorCard
          holdings={hasAnything ? { btc: gbp.btc, costGbp: gbp.costBasis } : null}
          live={{ usd: liveUsd, gbp: liveGbp }}
          onDragChange={(dragging) => setScrollable(!dragging)}
        />

        {groups.length > 0 && (
          <GlassCard>
            <Text style={styles.sectionTitle}>Your buys by signal</Text>
            <View style={styles.tableHead}>
              <Text style={[styles.th, styles.colSignal]}>Signal then</Text>
              <Text style={[styles.th, styles.colNum]}>Buys</Text>
              <Text style={[styles.th, styles.colNum]}>7d later</Text>
              <Text style={[styles.th, styles.colNum]}>30d later</Text>
            </View>
            {groups.map((g) => (
              <View key={g.action} style={styles.tr}>
                <Text style={[styles.td, styles.colSignal, { color: getSignalColor(g.action), fontWeight: '700' }]} numberOfLines={1}>
                  {ACTION_LABEL[g.action]}
                </Text>
                <Text style={[styles.td, styles.colNum]}>{g.buys}</Text>
                <Text style={[styles.td, styles.colNum, { color: moveColour(g.after7d.mean) }]}>
                  {g.after7d.mean != null ? formatPct(g.after7d.mean) : '…'}
                </Text>
                <Text style={[styles.td, styles.colNum, { color: moveColour(g.after30d.mean) }]}>
                  {g.after30d.mean != null ? formatPct(g.after30d.mean) : '…'}
                </Text>
              </View>
            ))}
            <Text style={styles.note}>
              Average price move after your buys, counting only buys old enough to have reached that date. A handful
              of trades is mostly luck either way, so compare with the track record on the Signals tab, which covers
              every day, not just the ones you bought on.
            </Text>
          </GlassCard>
        )}

        {newestFirst.map((t) => (
          <TradeCard
            key={t.id}
            trade={t}
            series={series}
            covered={isCoveredByOpening(t, journal.opening)}
            onPress={() => setDetailId(t.id)}
            onDelete={() => confirmDelete(t)}
          />
        ))}

        {journal.trades.length > 0 && (
          <Text style={styles.footnote} onPress={() => explain('tradeOutcomes')}>
            Moves are BTC's market price after each trade: green when it went your way. Over a day or a week, price
            moves are mostly noise, so one red number says little about the signal.{' '}
            <Text style={styles.inlineLink}>What do these mean?</Text>
          </Text>
        )}

        <GlassCard>
          <Text style={styles.sectionTitle}>Backup</Text>
          <Text style={styles.body}>
            Trades live only on this phone and are lost if the app is uninstalled. Updating the app keeps them.
          </Text>
          <View style={styles.backupRow}>
            <Pressable style={styles.linkBtn} onPress={() => exportAs('backup')} disabled={!hasAnything}>
              <Text style={[styles.link, !hasAnything && styles.disabled]}>Export backup</Text>
            </Pressable>
            <Pressable style={styles.linkBtn} onPress={() => exportAs('csv')} disabled={!hasAnything}>
              <Text style={[styles.link, !hasAnything && styles.disabled]}>Export CSV</Text>
            </Pressable>
            <Pressable style={styles.linkBtn} onPress={() => setRestoreOpen((o) => !o)}>
              <Text style={styles.link}>Restore</Text>
            </Pressable>
          </View>
          {restoreOpen && (
            <View style={{ marginTop: Spacing.md }}>
              <TextInput
                style={styles.restoreInput}
                value={restoreText}
                onChangeText={setRestoreText}
                placeholder="Paste an exported backup here"
                placeholderTextColor={Colors.textTertiary}
                multiline
              />
              <Pressable style={styles.restoreBtn} onPress={doRestore}>
                <Text style={styles.actionTextDark}>Restore trades</Text>
              </Pressable>
            </View>
          )}
        </GlassCard>

        <View style={{ height: 32 }} />
      </ScrollView>
      )}

      <AddTradeSheet visible={sheet != null} initialSide={sheet ?? 'buy'} onClose={() => setSheet(null)} />
      <OpeningSheet visible={openingOpen} onClose={() => setOpeningOpen(false)} />
      {detailTrade && (
        <TradeDetailSheet
          trade={detailTrade}
          series={series}
          covered={isCoveredByOpening(detailTrade, journal.opening)}
          onClose={() => setDetailId(null)}
          onDelete={confirmDelete}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  switch: { flexDirection: 'row', gap: 6 },
  switchBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.cardBorder },
  switchText: { ...Typography.caption, fontWeight: '600', color: Colors.textSecondary },
  headerTitle: { ...Typography.heading },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.md },
  sectionTitle: { ...Typography.subheading, marginBottom: Spacing.sm },
  body: { ...Typography.body, color: Colors.textSecondary, lineHeight: 22, fontSize: 15 },
  label: { ...Typography.caption },
  btcBig: { ...Typography.monoData, fontSize: 16, color: Colors.textSecondary, marginTop: 4 },
  valueBig: { ...Typography.priceDisplay, fontSize: 24, marginTop: 2 },
  pairRow: { flexDirection: 'row', gap: Spacing.md, marginTop: 2 },
  pairCell: { flex: 1 },
  pnl: { ...Typography.monoData, fontSize: 14, marginTop: 2 },
  statRow: { flexDirection: 'row', marginTop: Spacing.lg, gap: Spacing.md },
  stat: { flex: 1 },
  statLabel: { ...Typography.caption, color: Colors.textTertiary },
  statValue: { ...Typography.monoData, marginTop: 2 },
  statSub: { ...Typography.caption, color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  openingRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.lg, paddingTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.cardBorder,
  },
  openingText: { ...Typography.caption, flex: 1, lineHeight: 17 },
  inlineLink: { color: Colors.accent },
  note: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, marginTop: Spacing.md },
  actions: { flexDirection: 'row', gap: Spacing.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: BorderRadius.sm },
  buyBtn: { backgroundColor: Colors.accent },
  sellBtn: { backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.cardBorder },
  actionText: { ...Typography.body, fontWeight: '600' },
  actionTextDark: { ...Typography.body, fontWeight: '700', color: '#000' },
  tableHead: { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder },
  tr: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder },
  th: { ...Typography.caption, color: Colors.textTertiary, fontSize: 11 },
  td: { ...Typography.caption, color: Colors.textPrimary, fontFamily: Fonts.mono },
  colSignal: { flex: 1.6 },
  colNum: { flex: 1, textAlign: 'right' },
  footnote: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, paddingHorizontal: Spacing.xs },
  backupRow: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.md, flexWrap: 'wrap' },
  linkBtn: { paddingVertical: 4 },
  link: { ...Typography.body, color: Colors.accent, fontWeight: '600' },
  disabled: { color: Colors.textTertiary },
  restoreInput: {
    ...Typography.caption, fontFamily: Fonts.mono, color: Colors.textPrimary, backgroundColor: Colors.elevated,
    borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.cardBorder, padding: 10, minHeight: 90, textAlignVertical: 'top',
  },
  restoreBtn: { marginTop: Spacing.sm, backgroundColor: Colors.accent, borderRadius: BorderRadius.sm, paddingVertical: 10, alignItems: 'center' },
});
