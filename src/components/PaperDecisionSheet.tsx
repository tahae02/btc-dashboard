import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import { useData } from '../context/DataContext';
import { useJournal } from '../context/JournalContext';
import { usePaperTrading } from '../context/PaperTradingContext';
import { InfoButton } from './InfoButton';
import { makeId, summariseHoldings, type TradeSide } from '../services/journal';
import {
  ADVICE_LABEL, ADVICE_SOURCES, SCENARIOS, SCENARIO_LABEL, VERDICTS, VERDICT_LABEL, CONFIDENCES, CONFIDENCE_LABEL,
  ORDER_EXPIRY_DAYS, VS_APP_LABEL, suggestedAmount, compareWithApp, paperFigures, parsePaperAmount, parseLimitOrder,
  parseUsualAmount, parseChance, detectConditions, isBriefEmpty,
  type AdviceSource, type Scenario, type BriefVerdict, type Confidence, type BriefCall, type DecisionMeta,
  type PaperTrade, type PaperOrder, type PaperSkip,
} from '../services/paper';
import { ACTION_LABEL } from '../services/signalEngine';
import { formatMoney, formatBtc, formatDateTime, currencySymbol } from '../services/format';
import { Colors, Typography, Spacing, BorderRadius, getSignalColor } from '../constants/theme';

const DAY = 24 * 60 * 60 * 1000;

type Mode = 'now' | 'limit' | 'skip';

interface Props {
  visible: boolean;
  initialSide: TradeSide;
  onClose: () => void;
}

/** A row of choices that wraps, so long labels never get cut off on a narrow phone. */
const Chips = <T extends string | number>({
  options, value, onChange, label,
}: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
}) => (
  <View style={styles.chips} accessibilityLabel={label}>
    {options.map((o) => {
      const on = o.value === value;
      return (
        <Pressable
          key={String(o.value)}
          onPress={() => onChange(o.value)}
          style={[styles.chip, on && styles.chipOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: on }}
        >
          <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
        </Pressable>
      );
    })}
  </View>
);

const MODES = [
  { value: 'now' as const, label: 'Buy now' },
  { value: 'limit' as const, label: 'Limit order' },
  { value: 'skip' as const, label: "Don't buy" },
];
const LIMIT_STEPS = [1, 2, 3, 5];

/**
 * One paper decision: a buy at the live price, a limit order, a decision not
 * to buy, or a sell. It puts the app's amount in for you, so following the
 * advice to the letter is the easy path, and records whose call it was and
 * why it was made now.
 */
export const PaperDecisionSheet = ({ visible, initialSide, onClose }: Props) => {
  const data = useData();
  const journal = useJournal();
  const paper = usePaperTrading();
  const ccy = paper.settings.currency;
  const sym = currencySymbol(ccy);

  const [side, setSide] = useState<TradeSide>(initialSide);
  const [mode, setMode] = useState<Mode>('now');
  const [usual, setUsual] = useState('');
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [limit, setLimit] = useState('');
  const [expiryDays, setExpiryDays] = useState<number>(2);
  const [advice, setAdvice] = useState<AdviceSource>('app');
  const [scenario, setScenario] = useState<Scenario>('routine');
  const [verdict, setVerdict] = useState<BriefVerdict | null>(null);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [lower24, setLower24] = useState('');
  const [lower48, setLower48] = useState('');
  const [lower7, setLower7] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Fresh each time it opens.
  const savedUsual = paper.settings.usualAmount;
  useEffect(() => {
    if (!visible) return;
    setSide(initialSide);
    setMode('now');
    setUsual(savedUsual != null ? String(savedUsual) : '');
    setAmount('');
    setAmountTouched(false);
    setLimit('');
    setExpiryDays(2);
    setAdvice(initialSide === 'sell' ? 'own' : 'app');
    setScenario('routine');
    setVerdict(null);
    setConfidence(null);
    setLower24('');
    setLower48('');
    setLower7('');
    setNote('');
    setError(null);
  }, [visible, initialSide, savedUsual]);

  useEffect(() => setError(null), [side, mode, usual, amount, limit, advice, lower24, lower48, lower7]);

  // Paper trades are always at the live price, never a saved one from an earlier launch.
  const live = data.isLive && data.price ? data.price : null;
  const price = live ? (ccy === 'GBP' ? live.price_gbp : live.price) || null : null;
  const stamp = data.isLive ? journal.liveStamp : null;

  const usualValue = parseUsualAmount(usual);
  const usualNum = typeof usualValue === 'number' ? usualValue : null;
  const suggestion = suggestedAmount(usualNum, stamp);

  // The app's amount goes in by itself until you type your own, including
  // each time the sheet opens (the reset above has just cleared it).
  useEffect(() => {
    if (visible && !amountTouched && side === 'buy') setAmount(suggestion != null ? String(suggestion) : '');
  }, [visible, suggestion, amountTouched, side]);

  const liveUsd = live?.price ?? 0;
  const liveGbp = live?.price_gbp ?? 0;
  const held = useMemo(
    () => summariseHoldings(paper.book.trades, ccy, { usd: liveUsd, gbp: liveGbp }, null).btc,
    [paper.book.trades, ccy, liveUsd, liveGbp]
  );

  const conditions = detectConditions({
    change24hPct: paper.change24hPct,
    change7dPct: paper.change7dPct,
    fearGreed: data.fearGreed?.current?.value ?? null,
    adviceChange: paper.adviceChange,
  });

  const amountNum = (() => {
    const r = parsePaperAmount(amount, side, price, held, ccy);
    return r.ok ? r.amount : null;
  })();
  const vsApp = side === 'buy' && mode !== 'skip' && amountNum != null ? compareWithApp(amountNum, suggestion) : null;
  const marketFee = paper.settings.marketFeePct;
  const limitFee = paper.settings.limitFeePct;
  const limitParsed = mode === 'limit' ? parseLimitOrder(amount, limit, price, ccy) : null;

  const setLimitBelow = (pct: number) => {
    if (price) setLimit(String(Math.round(price * (1 - pct / 100))));
  };
  const setSellShare = (share: number) => {
    if (!price) return;
    setAmount(String(Math.floor(held * price * share * 100) / 100));
    setAmountTouched(true);
  };

  const buildMeta = (): { ok: true; meta: DecisionMeta } | { ok: false; error: string } => {
    if (usualValue === 'bad') return { ok: false, error: 'Enter your usual amount as a number, like 100, or leave it blank.' };
    let brief: BriefCall | null = null;
    if (advice === 'brief') {
      const chances = [parseChance(lower24), parseChance(lower48), parseChance(lower7)];
      if (chances.some((c) => c === 'bad')) return { ok: false, error: 'Enter each chance as a number from 0 to 100, or leave it blank.' };
      const [a, b, c] = chances as (number | null)[];
      const call: BriefCall = { verdict, confidence, lower24h: a ?? null, lower48h: b ?? null, lower7d: c ?? null };
      brief = isBriefEmpty(call) ? null : call;
    }
    return {
      ok: true,
      meta: {
        advice,
        scenario,
        usualAmount: usualNum,
        // The app only ever scales buys, so a sell has no app amount to compare with.
        suggestedAmount: side === 'buy' ? suggestion : null,
        change24hPct: paper.change24hPct,
        brief,
      },
    };
  };

  const save = () => {
    if (!live || !price) {
      setError('Waiting for a live price. Paper trades are always made at the live price.');
      return;
    }
    const m = buildMeta();
    if (!m.ok) {
      setError(m.error);
      return;
    }
    const now = Date.now();
    const base = {
      currency: ccy,
      marketPriceUsd: live.price || null,
      marketPriceGbp: live.price_gbp || null,
      signal: stamp,
      note: note.trim(),
      createdAt: now,
    };

    if (side === 'buy' && mode === 'skip') {
      const skip: PaperSkip = { id: makeId(now), time: now, meta: m.meta, after: {}, ...base };
      paper.addSkip(skip);
    } else if (side === 'buy' && mode === 'limit') {
      const r = parseLimitOrder(amount, limit, price, ccy);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const order: PaperOrder = {
        id: makeId(now),
        total: r.total,
        limitPrice: r.limitPrice,
        feePct: limitFee,
        placedAt: now,
        expiresAt: now + expiryDays * DAY,
        marketAtPlacement: price,
        meta: m.meta,
        status: 'open',
        closedAt: null,
        priceAtClose: null,
        tradeId: null,
        after: {},
        ...base,
      };
      paper.placeOrder(order);
    } else {
      const r = parsePaperAmount(amount, side, price, held, ccy);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const f = paperFigures(side, r.amount, price, marketFee);
      if (!f || f.btc == null) {
        setError('That amount is too small once the fee is taken off.');
        return;
      }
      const trade: PaperTrade = {
        id: makeId(now),
        side,
        time: now,
        fiat: f.fiat,
        btc: f.btc,
        unitPrice: f.unitPrice,
        fee: f.fee,
        paper: { ...m.meta, orderId: null, after: {} },
        ...base,
      };
      paper.addTrade(trade);
    }
    if (usualNum !== savedUsual) paper.setSettings({ usualAmount: usualNum });
    onClose();
  };

  const isBuy = side === 'buy';
  const title = !isBuy ? 'Paper sell' : mode === 'limit' ? 'Paper limit order' : mode === 'skip' ? 'Decide not to buy' : 'Paper buy';
  const saveLabel = !isBuy ? 'Save paper sell' : mode === 'limit' ? 'Place paper order' : mode === 'skip' ? 'Save decision' : 'Save paper buy';

  // What will be saved, so nothing is a surprise afterwards.
  const preview = (() => {
    if (!price) return null;
    if (isBuy && mode === 'skip') {
      return `Records that you chose not to buy now, with the market and the signal as they stand.${
        suggestion != null ? ` The app's amount was ${formatMoney(suggestion, ccy)}.` : ''
      }`;
    }
    if (isBuy && mode === 'limit') {
      if (!limitParsed?.ok) return null;
      const f = paperFigures('buy', limitParsed.total, limitParsed.limitPrice, limitFee);
      if (!f?.btc) return null;
      const below = ((1 - limitParsed.limitPrice / price) * 100).toFixed(1);
      return (
        `If the price falls to ${formatMoney(limitParsed.limitPrice, ccy)} (${below}% below now) by ` +
        `${formatDateTime(Date.now() + expiryDays * DAY)}, this buys ${formatBtc(f.btc)} BTC for ` +
        `${formatMoney(f.fiat, ccy)}, fee ${formatMoney(f.fee, ccy)} (${limitFee}%). If not, nothing is bought.`
      );
    }
    if (amountNum == null) return null;
    const f = paperFigures(side, amountNum, price, marketFee);
    if (!f?.btc) return null;
    return isBuy
      ? `${formatBtc(f.btc)} BTC for ${formatMoney(f.fiat, ccy)} at ${formatMoney(price, ccy)} per BTC, fee ${formatMoney(f.fee, ccy)} (${marketFee}%).`
      : `Sells ${formatBtc(f.btc)} BTC at ${formatMoney(price, ccy)}: you receive ${formatMoney(f.fiat, ccy)} after a ${formatMoney(f.fee, ccy)} fee (${marketFee}%).`;
  })();

  const typed = amount.trim() !== '' || limit.trim() !== '';
  const liveError = (() => {
    if (!typed || (isBuy && mode === 'skip')) return null;
    if (isBuy && mode === 'limit') return limitParsed && !limitParsed.ok && limit.trim() ? limitParsed.error : null;
    const r = parsePaperAmount(amount, side, price, held, ccy);
    return r.ok ? null : r.error;
  })();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={styles.titleRow}>
              <View style={styles.titleLeft}>
                <Text style={styles.title}>{title}</Text>
                <View style={styles.badge}><Text style={styles.badgeText}>PAPER</Text></View>
              </View>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>

            <SegmentedButtons
              value={side}
              onValueChange={(v) => {
                setSide(v as TradeSide);
                setAdvice(v === 'sell' ? 'own' : 'app');
                // A buy amount means nothing as a sell, and the other way round.
                setAmount('');
                setAmountTouched(false);
              }}
              buttons={[
                { value: 'buy', label: 'Buy', style: styles.segBtn },
                { value: 'sell', label: 'Sell', style: styles.segBtn },
              ]}
            />

            {isBuy && <Chips label="What to do" options={MODES} value={mode} onChange={setMode} />}

            {/* What following the app means right now. */}
            <View style={styles.adviceBox}>
              {stamp ? (
                <Text style={styles.adviceLine}>
                  The app now:{' '}
                  <Text style={{ color: getSignalColor(stamp.action), fontWeight: '700' }}>{ACTION_LABEL[stamp.action]}</Text>
                  {' '}· {stamp.dcaMultiplier}× your usual · conviction {stamp.conviction}%
                </Text>
              ) : (
                <Text style={styles.adviceLine}>
                  {data.isLive ? 'The signal is still loading; the decision is saved without one.' : 'Waiting for live prices.'}
                </Text>
              )}
              {isBuy ? (
                <>
                  <View style={styles.usualRow}>
                    <View style={styles.labelRow}>
                      <Text style={styles.usualLabel}>Your usual amount</Text>
                      <InfoButton term="dcaMultiplier" size={14} />
                    </View>
                    <TextInput
                      style={[styles.input, styles.usualInput]}
                      value={usual}
                      onChangeText={setUsual}
                      placeholder={`${sym}100`}
                      keyboardType="decimal-pad"
                      placeholderTextColor={Colors.textTertiary}
                      accessibilityLabel="Your usual amount"
                    />
                  </View>
                  {suggestion != null ? (
                    <View style={styles.suggestRow}>
                      <Text style={styles.suggestText}>
                        The app&apos;s amount: <Text style={styles.suggestAmount}>{formatMoney(suggestion, ccy)}</Text>
                      </Text>
                      {mode !== 'skip' && amountNum !== suggestion && (
                        <Pressable
                          onPress={() => {
                            setAmount(String(suggestion));
                            setAmountTouched(false);
                          }}
                          style={styles.useBtn}
                          accessibilityRole="button"
                        >
                          <Text style={styles.useText}>Use it</Text>
                        </Pressable>
                      )}
                    </View>
                  ) : (
                    <Text style={styles.hint}>
                      Enter the amount you would normally buy each time, and the app works out its amount from that.
                    </Text>
                  )}
                </>
              ) : (
                <Text style={styles.hint}>
                  The app never advises selling: it only scales how much to buy. A paper sell is your own call or
                  Claude&apos;s.
                </Text>
              )}
            </View>

            {(!isBuy || mode !== 'skip') && (
              <>
                <Text style={styles.label}>
                  {!isBuy ? 'Value to sell, at today\'s price' : mode === 'limit' ? 'Amount to spend if it fills, fee included' : 'Amount to spend, fee included'}
                </Text>
                <TextInput
                  style={styles.input}
                  value={amount}
                  onChangeText={(v) => {
                    setAmount(v);
                    setAmountTouched(true);
                  }}
                  placeholder={`${sym}0.00`}
                  keyboardType="decimal-pad"
                  placeholderTextColor={Colors.textTertiary}
                  accessibilityLabel="Amount"
                />
                {!isBuy && (
                  <View style={styles.quickRow}>
                    <Text style={styles.hint}>
                      Paper holdings {formatBtc(held)} BTC{price ? `, worth ${formatMoney(held * price, ccy)}` : ''}.
                    </Text>
                    {held > 0 &&
                      ([[0.25, '25%'], [0.5, '50%'], [1, 'All']] as const).map(([share, label]) => (
                        <Pressable key={label} onPress={() => setSellShare(share)} style={styles.quick} accessibilityRole="button">
                          <Text style={styles.quickText}>{label}</Text>
                        </Pressable>
                      ))}
                  </View>
                )}
              </>
            )}

            {isBuy && mode === 'limit' && (
              <>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Buy at, per BTC</Text>
                  <InfoButton term="limitOrder" size={14} />
                </View>
                <TextInput
                  style={styles.input}
                  value={limit}
                  onChangeText={setLimit}
                  placeholder={price ? `${sym}${Math.round(price * 0.98)}` : `${sym}0`}
                  keyboardType="decimal-pad"
                  placeholderTextColor={Colors.textTertiary}
                  accessibilityLabel="Limit price per BTC"
                />
                <View style={styles.quickRow}>
                  <Text style={styles.hint}>{price ? `Now ${formatMoney(price, ccy)}.` : 'No live price yet.'}</Text>
                  {LIMIT_STEPS.map((p) => (
                    <Pressable key={p} onPress={() => setLimitBelow(p)} style={styles.quick} accessibilityRole="button" disabled={!price}>
                      <Text style={styles.quickText}>-{p}%</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.label}>Cancel it if it has not filled within</Text>
                <Chips
                  label="Expiry"
                  options={ORDER_EXPIRY_DAYS.map((d) => ({ value: d as number, label: d === 1 ? '1 day' : `${d} days` }))}
                  value={expiryDays}
                  onChange={setExpiryDays}
                />
              </>
            )}
            {liveError && <Text style={styles.error}>{liveError}</Text>}

            <Text style={styles.label}>Whose call is this?</Text>
            <Chips label="Whose call" options={ADVICE_SOURCES.map((a) => ({ value: a, label: ADVICE_LABEL[a] }))} value={advice} onChange={setAdvice} />

            {advice === 'brief' && (
              <View style={styles.briefBox}>
                <Text style={styles.hint}>What the brief said. All optional, but the chances are what lets its calls be scored later.</Text>
                <Text style={styles.smallLabel}>Verdict</Text>
                <Chips label="Verdict" options={VERDICTS.map((v) => ({ value: v, label: VERDICT_LABEL[v] }))} value={verdict} onChange={(v) => setVerdict(v === verdict ? null : v)} />
                <Text style={styles.smallLabel}>Confidence</Text>
                <Chips label="Confidence" options={CONFIDENCES.map((c) => ({ value: c, label: CONFIDENCE_LABEL[c] }))} value={confidence} onChange={(c) => setConfidence(c === confidence ? null : c)} />
                <Text style={styles.smallLabel}>Chance the price is lower than now in</Text>
                <View style={styles.row}>
                  {([['24 hours', lower24, setLower24], ['48 hours', lower48, setLower48], ['7 days', lower7, setLower7]] as const).map(([label, v, set]) => (
                    <View key={label} style={styles.flex}>
                      <Text style={styles.tinyLabel}>{label}</Text>
                      <TextInput
                        style={styles.input}
                        value={v}
                        onChangeText={set}
                        placeholder="%"
                        keyboardType="decimal-pad"
                        placeholderTextColor={Colors.textTertiary}
                        accessibilityLabel={`Chance lower in ${label}`}
                      />
                    </View>
                  ))}
                </View>
              </View>
            )}

            <Text style={styles.label}>Why now?</Text>
            <Chips label="Why now" options={SCENARIOS.map((sc) => ({ value: sc, label: SCENARIO_LABEL[sc] }))} value={scenario} onChange={setScenario} />
            {conditions.notes.map((n) => (
              <Text key={n} style={styles.condition}>Right now: {n}</Text>
            ))}

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="e.g. split from the brief, first half"
              placeholderTextColor={Colors.textTertiary}
              maxLength={200}
            />

            {preview && (
              <View style={styles.preview}>
                <Text style={styles.previewText}>{preview}</Text>
                {vsApp && (
                  <Text style={[styles.previewLabel, { color: vsApp === 'same' ? Colors.bullish : Colors.neutral }]}>
                    {VS_APP_LABEL[vsApp]}
                    {vsApp !== 'same' && suggestion != null ? ` (${formatMoney(suggestion, ccy)})` : ''}.
                  </Text>
                )}
              </View>
            )}

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={styles.save} onPress={save} accessibilityRole="button">
              <Text style={styles.saveText}>{saveLabel}</Text>
            </Pressable>
            <Text style={styles.footHint}>No real money moves. Paper trades stay on this phone, apart from your real ones.</Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    maxHeight: '92%', backgroundColor: Colors.card, borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.paper + '55',
  },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  titleLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1 },
  title: { ...Typography.heading, flexShrink: 1 },
  badge: { backgroundColor: Colors.paper + '26', borderRadius: BorderRadius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { ...Typography.caption, color: Colors.paper, fontWeight: '700', fontSize: 11 },
  cancel: { ...Typography.body, color: Colors.paper },
  segBtn: { borderColor: Colors.cardBorder },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.elevated },
  chipOn: { borderColor: Colors.paper, backgroundColor: Colors.paper + '26' },
  chipText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600' },
  chipTextOn: { color: Colors.paper },
  adviceBox: { marginTop: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.elevated, borderRadius: BorderRadius.sm, gap: Spacing.sm },
  adviceLine: { ...Typography.caption, color: Colors.textPrimary, lineHeight: 18 },
  usualRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  usualLabel: { ...Typography.caption, color: Colors.textSecondary },
  usualInput: { width: 120, paddingVertical: 6 },
  suggestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  suggestText: { ...Typography.caption, color: Colors.textSecondary, flexShrink: 1 },
  suggestAmount: { ...Typography.monoData, color: Colors.textPrimary },
  useBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.paper },
  useText: { ...Typography.caption, color: Colors.paper, fontWeight: '700' },
  label: { ...Typography.caption, color: Colors.textSecondary, marginTop: Spacing.md },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  smallLabel: { ...Typography.caption, color: Colors.textSecondary, marginTop: Spacing.sm },
  tinyLabel: { ...Typography.caption, color: Colors.textTertiary, fontSize: 11, marginBottom: 2 },
  hint: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, flexShrink: 1 },
  condition: { ...Typography.caption, color: Colors.neutral, lineHeight: 17 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  flex: { flex: 1 },
  quickRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  quick: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.cardBorder },
  quickText: { ...Typography.caption, color: Colors.textPrimary, fontWeight: '600' },
  briefBox: { padding: Spacing.md, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.cardBorder, gap: 6 },
  input: {
    ...Typography.monoData, backgroundColor: Colors.elevated, borderRadius: BorderRadius.sm,
    borderWidth: 1, borderColor: Colors.cardBorder, paddingHorizontal: 12, paddingVertical: 10, color: Colors.textPrimary,
  },
  preview: { marginTop: Spacing.md, padding: Spacing.md, backgroundColor: Colors.elevated, borderRadius: BorderRadius.sm, gap: 6 },
  previewText: { ...Typography.caption, color: Colors.textPrimary, lineHeight: 18 },
  previewLabel: { ...Typography.caption, fontWeight: '600' },
  error: { ...Typography.caption, color: Colors.bearish, marginTop: Spacing.sm },
  save: { marginTop: Spacing.lg, backgroundColor: Colors.paper, borderRadius: BorderRadius.sm, paddingVertical: 14, alignItems: 'center' },
  saveText: { ...Typography.body, color: '#000', fontWeight: '700' },
  footHint: { ...Typography.caption, color: Colors.textTertiary, textAlign: 'center', marginTop: Spacing.sm },
});
