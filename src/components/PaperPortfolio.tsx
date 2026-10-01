import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Share, TextInput } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../context/DataContext';
import { useJournal } from '../context/JournalContext';
import { usePaperTrading } from '../context/PaperTradingContext';
import { GlassCard } from './GlassCard';
import { InfoButton } from './InfoButton';
import { TradeCard } from './TradeCard';
import { TradeDetailSheet } from './TradeDetailSheet';
import { PaperDecisionSheet } from './PaperDecisionSheet';
import { PaperScorecardCard } from './PaperScorecardCard';
import { PaperGuideCard } from './PaperGuideCard';
import { summariseHoldings, type TradeSide } from '../services/journal';
import {
  ADVICE_LABEL, SCENARIO_LABEL, ORDER_STATUS_LABEL, VS_APP_LABEL, timeline, compareWithApp, moveAfter, serialisePaperBackup,
  paperToCsv, parseUsualAmount, type PaperOrder, type PaperSkip, type PaperTrade, type AfterKey,
} from '../services/paper';
import { scorePaper } from '../services/paperReview';
import { ACTION_LABEL } from '../services/signalEngine';
import { formatMoney, formatBtc, formatPct, formatDateTime, isFlat, currencySymbol } from '../services/format';
import { Colors, Typography, Spacing, BorderRadius, Fonts, getSignalColor } from '../constants/theme';
import type { Currency } from '../types';

const pnlColour = (n: number | null | undefined) => (n == null || n === 0 ? Colors.textSecondary : n > 0 ? Colors.bullish : Colors.bearish);
const moveColour = (n: number | null, good: boolean | null) =>
  n == null || isFlat(n) ? Colors.textSecondary : good ? Colors.bullish : Colors.bearish;
const belowPct = (o: PaperOrder) => `${((1 - o.limitPrice / o.marketAtPlacement) * 100).toFixed(1)}%`;

const SKIP_HORIZONS: { key: AfterKey; label: string; days: number }[] = [
  { key: '24h', label: '1d', days: 1 },
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
];

/** Whose call, why, and how it compared with the app, for under a paper trade. */
const decisionLines = (t: PaperTrade, order: PaperOrder | null): string[] => {
  const lines = [`${ADVICE_LABEL[t.paper.advice]} · ${SCENARIO_LABEL[t.paper.scenario]}`];
  if (order) lines.push(`From a limit order placed ${formatDateTime(order.placedAt)}, ${belowPct(order)} below the price then`);
  const vs = t.side === 'buy' ? compareWithApp(t.fiat, t.paper.suggestedAmount) : null;
  if (vs) lines.push(`${VS_APP_LABEL[vs]}${vs !== 'same' && t.paper.suggestedAmount != null ? ` (${formatMoney(t.paper.suggestedAmount, t.currency)})` : ''}`);
  return lines;
};

/** A decision not to buy, and what the price did after it: falling is what made holding back right. */
const SkipCard = ({ s, onDelete }: { s: PaperSkip; onDelete: () => void }) => (
  <GlassCard style={styles.paperCard}>
    <View style={styles.cardTop}>
      <View style={styles.cardTopLeft}>
        <View style={[styles.pill, { backgroundColor: Colors.neutral + '26' }]}>
          <Text style={[styles.pillText, { color: Colors.neutral }]}>DIDN&apos;T BUY</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: Colors.paper + '26' }]}>
          <Text style={[styles.pillText, { color: Colors.paper }]}>PAPER</Text>
        </View>
        <Text style={styles.date}>{formatDateTime(s.time)}</Text>
      </View>
      <Pressable onPress={onDelete} hitSlop={10} accessibilityLabel="Delete decision">
        <Ionicons name="trash-outline" size={18} color={Colors.textTertiary} />
      </Pressable>
    </View>
    <Text style={styles.cardMain}>
      {s.meta.suggestedAmount != null ? `The app's amount was ${formatMoney(s.meta.suggestedAmount, s.currency)}` : 'Decided not to buy'}
    </Text>
    <Text style={styles.cardLine}>{ADVICE_LABEL[s.meta.advice]} · {SCENARIO_LABEL[s.meta.scenario]}</Text>
    {s.signal && (
      <Text style={styles.cardLine}>
        <Text style={{ color: getSignalColor(s.signal.action), fontWeight: '700' }}>{ACTION_LABEL[s.signal.action]}</Text>
        {` · ${s.signal.dcaMultiplier}× · conviction ${s.signal.conviction}%`}
        {s.signal.fearGreed != null ? ` · F&G ${s.signal.fearGreed}` : ''}
      </Text>
    )}
    <View style={styles.outcomes}>
      {SKIP_HORIZONS.map((h) => {
        const m = moveAfter(s.marketPriceUsd, s.after, h.key);
        const due = s.time + h.days * 86400000;
        return (
          <View key={h.key} style={styles.outcome}>
            <Text style={styles.outcomeLabel}>{h.label} later</Text>
            {m != null ? (
              <Text style={[styles.outcomeValue, { color: moveColour(m, m < 0) }]}>{formatPct(m)}</Text>
            ) : (
              <Text style={styles.outcomePending}>{due > Date.now() ? `in ${Math.max(1, Math.ceil((due - Date.now()) / 86400000))}d` : '…'}</Text>
            )}
          </View>
        );
      })}
    </View>
    {s.note ? <Text style={styles.note}>{s.note}</Text> : null}
  </GlassCard>
);

/** A limit order that ran out, was cancelled or could no longer be checked. */
const ClosedOrderCard = ({ o, onDelete }: { o: PaperOrder; onDelete: () => void }) => {
  const moved = o.priceAtClose != null ? o.priceAtClose / o.marketAtPlacement - 1 : null;
  return (
    <GlassCard style={styles.paperCard}>
      <View style={styles.cardTop}>
        <View style={styles.cardTopLeft}>
          <View style={[styles.pill, { backgroundColor: Colors.textTertiary + '33' }]}>
            <Text style={[styles.pillText, { color: Colors.textSecondary }]}>{ORDER_STATUS_LABEL[o.status].toUpperCase()}</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: Colors.paper + '26' }]}>
            <Text style={[styles.pillText, { color: Colors.paper }]}>PAPER</Text>
          </View>
          <Text style={styles.date}>{formatDateTime(o.placedAt)}</Text>
        </View>
        <Pressable onPress={onDelete} hitSlop={10} accessibilityLabel="Delete order">
          <Ionicons name="trash-outline" size={18} color={Colors.textTertiary} />
        </Pressable>
      </View>
      <Text style={styles.cardMain}>Limit buy {formatMoney(o.total, o.currency)} at {formatMoney(o.limitPrice, o.currency)}</Text>
      <Text style={styles.cardLine}>
        {belowPct(o)} below the {formatMoney(o.marketAtPlacement, o.currency)} when placed. Never filled.
      </Text>
      {o.closedAt != null && (
        <Text style={styles.cardLine}>
          {o.status === 'expired' ? 'Ran out' : o.status === 'cancelled' ? 'Cancelled' : 'Stopped being checkable'} {formatDateTime(o.closedAt)}
          {o.priceAtClose != null && moved != null ? `, price then ${formatMoney(o.priceAtClose, o.currency)} (${formatPct(moved)} from placing)` : ''}
        </Text>
      )}
      {o.status === 'lapsed' && (
        <Text style={styles.cardLine}>The app was not opened for weeks, and the hourly prices no longer reach back to when it was placed.</Text>
      )}
      <Text style={styles.cardLine}>{ADVICE_LABEL[o.meta.advice]} · {SCENARIO_LABEL[o.meta.scenario]}</Text>
      {o.note ? <Text style={styles.note}>{o.note}</Text> : null}
    </GlassCard>
  );
};

/**
 * The paper half of the Portfolio tab: paper holdings, decisions, waiting
 * orders, the scorecard, the guide, and its own backup. Nothing here touches
 * the real journal.
 */
export const PaperPortfolio = () => {
  const data = useData();
  const journal = useJournal();
  const paper = usePaperTrading();
  const { book, settings } = paper;
  const [sheet, setSheet] = useState<TradeSide | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreText, setRestoreText] = useState('');

  // Hourly bars give each decision its 24-hour change, and make the 1-day
  // results of recent trades accurate to the hour.
  const { loadTimeframe } = data;
  const hourlyCount = data.ohlcv['1H'].length;
  useEffect(() => {
    if (!hourlyCount) loadTimeframe('1H');
  }, [hourlyCount, loadTimeframe]);

  const liveUsd = data.price?.price ?? 0;
  const liveGbp = data.price?.price_gbp ?? 0;
  const live = useMemo(() => ({ usd: liveUsd, gbp: liveGbp }), [liveUsd, liveGbp]);
  const gbp = useMemo(() => summariseHoldings(book.trades, 'GBP', live), [book.trades, live]);
  const usd = useMemo(() => summariseHoldings(book.trades, 'USD', live), [book.trades, live]);
  const card = useMemo(() => scorePaper(book, journal.trades, live), [book, journal.trades, live]);
  const items = useMemo(() => timeline(book), [book]);
  const openOrders = book.orders.filter((o) => o.status === 'open');
  const hasAnything = items.length > 0 || openOrders.length > 0;
  const hasPrice = liveUsd > 0;

  // What your real buys have actually paid in fees, to set the paper ones by.
  const realFeePct = useMemo(() => {
    const withFee = journal.trades.filter((t) => t.side === 'buy' && t.fee > 0 && t.fiat > 0);
    return withFee.length ? withFee.reduce((a, t) => a + (t.fee / t.fiat) * 100, 0) / withFee.length : null;
  }, [journal.trades]);

  const detail = detailId ? book.trades.find((t) => t.id === detailId) ?? null : null;
  const detailOrder = detail?.paper.orderId ? book.orders.find((o) => o.id === detail.paper.orderId) ?? null : null;

  const confirmDeleteTrade = (t: PaperTrade) => {
    Alert.alert(
      'Delete this paper trade?',
      `Paper ${t.side} of ${formatMoney(t.fiat, t.currency)} on ${formatDateTime(t.time)}.${t.paper.orderId ? ' The limit order it came from goes too.' : ''} ` +
        'Keeping the ones that went badly is what makes the record honest.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { paper.remove('trade', t.id); setDetailId(null); } },
      ]
    );
  };
  const confirmDelete = (kind: 'order' | 'skip', id: string, what: string) => {
    Alert.alert(`Delete this ${what}?`, 'It is removed from the paper record for good.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => paper.remove(kind, id) },
    ]);
  };
  const confirmCancel = (o: PaperOrder) => {
    Alert.alert('Cancel this paper order?', `Limit buy of ${formatMoney(o.total, o.currency)} at ${formatMoney(o.limitPrice, o.currency)}. It stays in the record as cancelled.`, [
      { text: 'Keep waiting', style: 'cancel' },
      { text: 'Cancel order', style: 'destructive', onPress: () => paper.cancelOrder(o.id) },
    ]);
  };

  const exportAs = async (kind: 'backup' | 'csv') => {
    const message = kind === 'backup' ? serialisePaperBackup(book, settings) : paperToCsv(book);
    try {
      await Share.share({ message, title: kind === 'backup' ? 'BTC Analyst paper backup' : 'BTC Analyst paper trades (CSV)' });
    } catch { /* dismissed */ }
  };

  const doRestore = () => {
    const r = paper.restore(restoreText);
    if (!r.ok) {
      Alert.alert('Nothing restored', r.error);
      return;
    }
    Alert.alert('Restored', `${r.count} paper decision${r.count === 1 ? '' : 's'} merged in${r.settings ? ', with your paper settings' : ''}.`);
    setRestoreText('');
    setRestoreOpen(false);
  };

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!hasAnything ? (
          <GlassCard style={styles.paperCard}>
            <View style={styles.titleRow}>
              <Text style={styles.sectionTitle}>Paper trading</Text>
              <InfoButton term="paperTrading" />
            </View>
            <Text style={styles.body}>
              Make the trades the advice calls for, with pretend money at real prices. Nothing is bought and nothing here
              touches your real holdings. Each decision records the full picture at that moment, plus whose advice you
              followed and why, so over the months you build up a record of how well the advice really does.
            </Text>
            <Text style={[styles.body, { marginTop: Spacing.sm }]}>
              Start on your next regular buy day: tap Paper buy and the app&apos;s amount is filled in for you.
            </Text>
          </GlassCard>
        ) : (
          <GlassCard style={styles.paperCard}>
            <View style={styles.titleRow}>
              <Text style={styles.label}>Paper holdings</Text>
              <View style={[styles.pill, { backgroundColor: Colors.paper + '26' }]}>
                <Text style={[styles.pillText, { color: Colors.paper }]}>PAPER MONEY</Text>
              </View>
            </View>
            <Text style={styles.btcBig}>{formatBtc(gbp.btc)} BTC</Text>
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
                <Text style={styles.statLabel}>Paper put in</Text>
                <Text style={styles.statValue}>{formatMoney(gbp.invested, 'GBP')}</Text>
                <Text style={styles.statSub}>{formatMoney(usd.invested, 'USD')}</Text>
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
            {gbp.sells > 0 && (
              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Realised from paper sells</Text>
                  <Text style={[styles.statValue, { color: pnlColour(gbp.realised) }]}>{formatMoney(gbp.realised, 'GBP', true)}</Text>
                  <Text style={styles.statSub}>{formatMoney(usd.realised, 'USD', true)}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Cost of paper holdings</Text>
                  <Text style={styles.statValue}>{formatMoney(gbp.costBasis, 'GBP')}</Text>
                  <Text style={styles.statSub}>{formatMoney(usd.costBasis, 'USD')}</Text>
                </View>
              </View>
            )}
            <Text style={styles.note}>
              Pretend money at real prices, with fees taken as set below. The other currency is converted at today&apos;s
              rate. None of this is in your real holdings.
            </Text>
          </GlassCard>
        )}

        <View style={styles.actions}>
          <Pressable style={[styles.actionBtn, styles.buyBtn]} onPress={() => setSheet('buy')} accessibilityRole="button">
            <Ionicons name="add" size={18} color="#000" />
            <Text style={styles.actionTextDark}>Paper buy</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, styles.sellBtn]} onPress={() => setSheet('sell')} accessibilityRole="button">
            <Ionicons name="remove" size={18} color={Colors.paper} />
            <Text style={styles.actionText}>Paper sell</Text>
          </Pressable>
        </View>

        <PaperSettingsCard
          open={settingsOpen}
          onToggle={() => setSettingsOpen((o) => !o)}
          realFeePct={realFeePct}
        />

        {openOrders.length > 0 && (
          <GlassCard style={styles.paperCard}>
            <View style={styles.titleRow}>
              <Text style={styles.sectionTitle}>Waiting limit orders</Text>
              <InfoButton term="limitOrder" />
            </View>
            {openOrders.map((o) => (
              <View key={o.id} style={styles.orderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderMain}>
                    {formatMoney(o.total, o.currency)} at {formatMoney(o.limitPrice, o.currency)}
                  </Text>
                  <Text style={styles.cardLine}>
                    {belowPct(o)} below the {formatMoney(o.marketAtPlacement, o.currency)} when placed · until {formatDateTime(o.expiresAt)}
                  </Text>
                  <Text style={styles.cardLine}>{ADVICE_LABEL[o.meta.advice]} · {SCENARIO_LABEL[o.meta.scenario]}</Text>
                </View>
                <Pressable onPress={() => confirmCancel(o)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel order">
                  <Text style={styles.link}>Cancel</Text>
                </Pressable>
              </View>
            ))}
            <Text style={styles.note}>
              Checked against hourly prices, so an order fills even while the app is closed; the fill shows up next time it
              opens. Only whole hours after placing count, which can miss a dip in the first few minutes but never invents one.
            </Text>
          </GlassCard>
        )}

        {card.decisions > 0 && <PaperScorecardCard card={card} />}

        {items.map((d) =>
          d.kind === 'trade' ? (
            <TradeCard
              key={d.trade.id}
              trade={d.trade}
              series={paper.usdSeries}
              onPress={() => setDetailId(d.trade.id)}
              onDelete={() => confirmDeleteTrade(d.trade)}
              paperLines={decisionLines(d.trade, d.order)}
            />
          ) : d.kind === 'skip' ? (
            <SkipCard key={d.skip.id} s={d.skip} onDelete={() => confirmDelete('skip', d.skip.id, 'decision')} />
          ) : (
            <ClosedOrderCard key={d.order.id} o={d.order} onDelete={() => confirmDelete('order', d.order.id, 'paper order')} />
          )
        )}

        {items.length > 0 && (
          <Text style={styles.footnote}>
            Moves are Bitcoin&apos;s dollar price after each decision. Green when it went your way: up after a buy, down
            after a sell or a decision not to buy.
          </Text>
        )}

        <PaperGuideCard initiallyOpen={!hasAnything} />

        <GlassCard>
          <Text style={styles.sectionTitle}>Paper backup</Text>
          <Text style={styles.body}>
            Paper trades have their own backup, separate from your real trades. The CSV has one row per decision with
            everything recorded, for a spreadsheet or for /paper-review in Claude.
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
                placeholder="Paste an exported paper backup here"
                placeholderTextColor={Colors.textTertiary}
                multiline
              />
              <Pressable style={styles.restoreBtn} onPress={doRestore}>
                <Text style={styles.actionTextDark}>Restore paper trades</Text>
              </Pressable>
            </View>
          )}
        </GlassCard>

        <View style={{ height: 32 }} />
      </ScrollView>

      <PaperDecisionSheet visible={sheet != null} initialSide={sheet ?? 'buy'} onClose={() => setSheet(null)} />
      {detail && (
        <TradeDetailSheet
          trade={detail}
          series={paper.usdSeries}
          covered={false}
          onClose={() => setDetailId(null)}
          onDelete={() => confirmDeleteTrade(detail)}
          paper={{ meta: detail.paper, order: detailOrder }}
        />
      )}
    </>
  );
};

/** Usual amount, currency and fees for paper trades. */
const PaperSettingsCard = ({ open, onToggle, realFeePct }: { open: boolean; onToggle: () => void; realFeePct: number | null }) => {
  const paper = usePaperTrading();
  const s = paper.settings;
  const [usual, setUsual] = useState('');
  const [marketFee, setMarketFee] = useState('');
  const [limitFee, setLimitFee] = useState('');
  const [currency, setCurrency] = useState<Currency>(s.currency);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsual(s.usualAmount != null ? String(s.usualAmount) : '');
    setMarketFee(String(s.marketFeePct));
    setLimitFee(String(s.limitFeePct));
    setCurrency(s.currency);
    setError(null);
  }, [open, s]);

  const save = () => {
    const u = parseUsualAmount(usual);
    const mf = Number(marketFee.replace('%', '').trim());
    const lf = Number(limitFee.replace('%', '').trim());
    if (u === 'bad') return setError('Enter your usual amount as a number, like 100, or leave it blank.');
    if (!marketFee.trim() || !Number.isFinite(mf) || mf < 0 || mf > 10) return setError('Enter the fee for buying now as a percentage from 0 to 10.');
    if (!limitFee.trim() || !Number.isFinite(lf) || lf < 0 || lf > 10) return setError('Enter the limit order fee as a percentage from 0 to 10.');
    paper.setSettings({ usualAmount: u, currency, marketFeePct: mf, limitFeePct: lf });
    onToggle();
  };

  return (
    <GlassCard>
      <Pressable onPress={onToggle} style={styles.settingsHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.settingsTitle}>Paper settings</Text>
          <Text style={styles.cardLine}>
            Usual amount {s.usualAmount != null ? formatMoney(s.usualAmount, s.currency) : 'not set'} · fees {s.marketFeePct}% buying
            now, {s.limitFeePct}% limit · in {s.currency === 'GBP' ? 'pounds' : 'dollars'}
          </Text>
        </View>
        <Text style={styles.link}>{open ? 'Close' : 'Edit'}</Text>
      </Pressable>
      {open && (
        <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Paper trades in</Text>
            <SegmentedButtons
              value={currency}
              onValueChange={(v) => setCurrency(v as Currency)}
              style={{ width: 150 }}
              buttons={[
                { value: 'GBP', label: '£', style: { borderColor: Colors.cardBorder } },
                { value: 'USD', label: '$', style: { borderColor: Colors.cardBorder } },
              ]}
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Usual amount each time</Text>
            <TextInput style={[styles.input, styles.settingInput]} value={usual} onChangeText={setUsual} placeholder={`${currencySymbol(currency)}100`} keyboardType="decimal-pad" placeholderTextColor={Colors.textTertiary} accessibilityLabel="Usual amount" />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Fee buying now, %</Text>
            <TextInput style={[styles.input, styles.settingInput]} value={marketFee} onChangeText={setMarketFee} keyboardType="decimal-pad" placeholderTextColor={Colors.textTertiary} accessibilityLabel="Fee for buying now, percent" />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Fee on a limit order, %</Text>
            <TextInput style={[styles.input, styles.settingInput]} value={limitFee} onChangeText={setLimitFee} keyboardType="decimal-pad" placeholderTextColor={Colors.textTertiary} accessibilityLabel="Fee on a limit order, percent" />
          </View>
          <Text style={styles.note}>
            The defaults are Coinbase Advanced&apos;s entry tier: 1.2% to buy at the live price, 0.6% for a limit order.
            {realFeePct != null
              ? ` Your real buys have paid ${realFeePct.toFixed(2)}% in fees on average.`
              : ' To match your own, divide the fee by the total on a recent Coinbase order.'}{' '}
            A change applies to new paper trades only.
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={styles.restoreBtn} onPress={save} accessibilityRole="button">
            <Text style={styles.actionTextDark}>Save paper settings</Text>
          </Pressable>
        </View>
      )}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.md },
  paperCard: { borderColor: Colors.paper + '40' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Spacing.xs },
  sectionTitle: { ...Typography.subheading },
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
  note: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, marginTop: Spacing.md },
  actions: { flexDirection: 'row', gap: Spacing.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: BorderRadius.sm },
  buyBtn: { backgroundColor: Colors.paper },
  sellBtn: { backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.paper + '80' },
  actionText: { ...Typography.body, fontWeight: '600', color: Colors.paper },
  actionTextDark: { ...Typography.body, fontWeight: '700', color: '#000' },
  pill: { borderRadius: BorderRadius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { ...Typography.caption, fontWeight: '700', fontSize: 11 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTopLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1, flexWrap: 'wrap' },
  date: { ...Typography.caption },
  cardMain: { ...Typography.monoData, fontSize: 15, marginTop: Spacing.sm },
  cardLine: { ...Typography.caption, color: Colors.textSecondary, marginTop: 4, fontSize: 11, lineHeight: 15 },
  outcomes: { flexDirection: 'row', marginTop: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.cardBorder },
  outcome: { flex: 1, alignItems: 'center' },
  outcomeLabel: { ...Typography.caption, color: Colors.textTertiary, fontSize: 11 },
  outcomeValue: { ...Typography.monoData, fontSize: 13, marginTop: 2 },
  outcomePending: { ...Typography.caption, color: Colors.textTertiary, marginTop: 2 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder },
  orderMain: { ...Typography.monoData, fontSize: 14 },
  footnote: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, paddingHorizontal: Spacing.xs },
  backupRow: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.md, flexWrap: 'wrap' },
  linkBtn: { paddingVertical: 4 },
  link: { ...Typography.body, color: Colors.paper, fontWeight: '600' },
  disabled: { color: Colors.textTertiary },
  restoreInput: {
    ...Typography.caption, fontFamily: Fonts.mono, color: Colors.textPrimary, backgroundColor: Colors.elevated,
    borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.cardBorder, padding: 10, minHeight: 90, textAlignVertical: 'top',
  },
  restoreBtn: { marginTop: Spacing.sm, backgroundColor: Colors.paper, borderRadius: BorderRadius.sm, paddingVertical: 10, alignItems: 'center' },
  settingsHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  settingsTitle: { ...Typography.body, fontWeight: '600' },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  settingLabel: { ...Typography.caption, color: Colors.textSecondary, flex: 1 },
  settingInput: { width: 120, paddingVertical: 6 },
  input: {
    ...Typography.monoData, backgroundColor: Colors.elevated, borderRadius: BorderRadius.sm,
    borderWidth: 1, borderColor: Colors.cardBorder, paddingHorizontal: 12, paddingVertical: 10, color: Colors.textPrimary,
  },
  error: { ...Typography.caption, color: Colors.bearish },
});
