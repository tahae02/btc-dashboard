import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import { useData } from '../context/DataContext';
import { useJournal } from '../context/JournalContext';
import { useSettings } from '../context/SettingsContext';
import { fetchOHLCV } from '../services/api';
import { parseTradeForm, priceAt, makeId, type TradeSide, type PriceSeries, type SignalStamp, type Trade } from '../services/journal';
import { reconstructStamp } from '../services/trackRecord';
import { ACTION_LABEL } from '../services/signalEngine';
import { TIMEFRAME_MS } from '../services/candles';
import { formatMoney, formatBtc, toDateInput, toTimeInput, currencySymbol } from '../services/format';
import { Colors, Typography, Spacing, BorderRadius, getSignalColor } from '../constants/theme';
import type { Currency, OHLCVCandle } from '../types';

interface Props {
  visible: boolean;
  initialSide: TradeSide;
  onClose: () => void;
}

type When = 'now' | 'earlier';

export const AddTradeSheet = ({ visible, initialSide, onClose }: Props) => {
  const data = useData();
  const settings = useSettings();
  const journal = useJournal();

  const [side, setSide] = useState<TradeSide>(initialSide);
  const [when, setWhen] = useState<When>('now');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>(settings.currency);
  const [btc, setBtc] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [gbp, setGbp] = useState<{ hourly: OHLCVCandle[]; daily: OHLCVCandle[] } | null>(null);

  // Fresh form each time it opens.
  useEffect(() => {
    if (!visible) return;
    const now = Date.now();
    setSide(initialSide);
    setWhen('now');
    setDate(toDateInput(now));
    setTime(toTimeInput(now));
    setAmount('');
    setCurrency(settings.currency);
    setBtc('');
    setNote('');
    setError(null);
  }, [visible, initialSide, settings.currency]);

  // Back-dated trades are priced from history: hourly for the last month,
  // daily before that. Pounds need Kraken's GBP candles, fetched on demand.
  const { loadTimeframe } = data;
  const hourlyUsd = data.ohlcv['1H'];
  useEffect(() => {
    if (!visible || when !== 'earlier') return;
    if (!hourlyUsd.length) loadTimeframe('1H');
  }, [visible, when, hourlyUsd.length, loadTimeframe]);
  useEffect(() => {
    if (!visible || when !== 'earlier' || currency !== 'GBP' || gbp) return;
    let cancelled = false;
    Promise.allSettled([fetchOHLCV('1H', 'GBP'), fetchOHLCV('1D', 'GBP')]).then(([h, d]) => {
      if (cancelled) return;
      setGbp({ hourly: h.status === 'fulfilled' ? h.value : [], daily: d.status === 'fulfilled' ? d.value : [] });
    });
    return () => { cancelled = true; };
  }, [visible, when, currency, gbp]);

  const usdSeries = useMemo<PriceSeries[]>(
    () => [
      { candles: hourlyUsd, intervalMs: TIMEFRAME_MS['1H'] },
      { candles: data.ohlcv['1D'], intervalMs: TIMEFRAME_MS['1D'] },
    ],
    [hourlyUsd, data.ohlcv]
  );
  const gbpSeries = useMemo<PriceSeries[]>(
    () => (gbp ? [{ candles: gbp.hourly, intervalMs: TIMEFRAME_MS['1H'] }, { candles: gbp.daily, intervalMs: TIMEFRAME_MS['1D'] }] : []),
    [gbp]
  );

  // Everything the preview and Save need, derived from the form.
  const draft = useMemo(() => {
    const now = Date.now();
    const parsed = parseTradeForm(
      { side, date: when === 'now' ? toDateInput(now) : date, time: when === 'now' ? toTimeInput(now) : time, amount, currency, btc },
      now
    );
    if (!parsed.ok) return { ok: false as const, error: parsed.error };

    const t = when === 'now' ? now : parsed.time;
    const live = data.price;
    const marketUsd = when === 'now' ? (live?.price || null) : priceAt(t, usdSeries);
    const marketCcy =
      when === 'now'
        ? (currency === 'GBP' ? live?.price_gbp : live?.price) || null
        : currency === 'USD'
        ? marketUsd
        : priceAt(t, gbpSeries);
    const stamp: SignalStamp | null = when === 'now' ? journal.liveStamp : reconstructStamp(journal.closedDaily, t, journal.config);
    const btcAmount = parsed.btc ?? (marketCcy ? parsed.fiat / marketCcy : null);
    return { ok: true as const, t, fiat: parsed.fiat, btcAmount, marketUsd, marketCcy, stamp, btcGiven: parsed.btc != null };
  }, [side, when, date, time, amount, currency, btc, data.price, usdSeries, gbpSeries, journal.liveStamp, journal.closedDaily, journal.config]);

  const save = () => {
    if (!draft.ok) {
      setError(draft.error);
      return;
    }
    if (draft.btcAmount == null || !(draft.btcAmount > 0)) {
      setError(
        when === 'now'
          ? 'No live price yet. Enter the BTC amount, or wait for the price to load.'
          : 'Could not find the market price for that time. Enter the BTC amount instead.'
      );
      return;
    }
    const trade: Trade = {
      id: makeId(),
      side,
      time: draft.t,
      fiat: draft.fiat,
      currency,
      btc: draft.btcAmount,
      marketPriceUsd: draft.marketUsd,
      signal: draft.stamp,
      note: note.trim(),
      createdAt: Date.now(),
    };
    journal.addTrade(trade);
    onClose();
  };

  const effectivePrice = draft.ok && draft.btcAmount ? draft.fiat / draft.btcAmount : null;
  const sym = currencySymbol(currency);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{side === 'buy' ? 'Log a buy' : 'Log a sell'}</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>

            <SegmentedButtons
              value={side}
              onValueChange={(v) => setSide(v as TradeSide)}
              buttons={[
                { value: 'buy', label: 'Buy', style: styles.segBtn },
                { value: 'sell', label: 'Sell', style: styles.segBtn },
              ]}
            />

            <Text style={styles.label}>When</Text>
            <SegmentedButtons
              value={when}
              onValueChange={(v) => setWhen(v as When)}
              buttons={[
                { value: 'now', label: 'Just now', style: styles.segBtn },
                { value: 'earlier', label: 'Earlier', style: styles.segBtn },
              ]}
            />
            {when === 'earlier' && (
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={Colors.textTertiary}
                  accessibilityLabel="Date, as year-month-day"
                />
                <TextInput
                  style={[styles.input, styles.timeInput]}
                  value={time}
                  onChangeText={setTime}
                  placeholder="HH:MM"
                  placeholderTextColor={Colors.textTertiary}
                  accessibilityLabel="Time, 24-hour"
                />
              </View>
            )}

            <Text style={styles.label}>{side === 'buy' ? 'Amount spent, fees included' : 'Amount received, after fees'}</Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.flex]}
                value={amount}
                onChangeText={setAmount}
                placeholder={`${sym}0`}
                keyboardType="decimal-pad"
                placeholderTextColor={Colors.textTertiary}
                accessibilityLabel="Amount"
              />
              <SegmentedButtons
                value={currency}
                onValueChange={(v) => setCurrency(v as Currency)}
                style={styles.ccy}
                buttons={[
                  { value: 'GBP', label: '£', style: styles.segBtn },
                  { value: 'USD', label: '$', style: styles.segBtn },
                ]}
              />
            </View>

            <Text style={styles.label}>{side === 'buy' ? 'BTC received (optional)' : 'BTC sold'}</Text>
            <TextInput
              style={styles.input}
              value={btc}
              onChangeText={setBtc}
              placeholder="Blank: worked out from the market price"
              keyboardType="decimal-pad"
              placeholderTextColor={Colors.textTertiary}
              accessibilityLabel="BTC amount"
            />
            <Text style={styles.hint}>
              Your exchange shows the exact figure. Entering it makes your average cost exact, fees included.
            </Text>

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="e.g. payday DCA"
              placeholderTextColor={Colors.textTertiary}
              maxLength={200}
            />

            {/* What will be saved, so nothing is a surprise afterwards. */}
            {draft.ok && (
              <View style={styles.preview}>
                {draft.btcAmount != null && (
                  <Text style={styles.previewText}>
                    {formatBtc(draft.btcAmount)} BTC
                    {effectivePrice ? ` at ${formatMoney(effectivePrice, currency)} per BTC` : ''}
                    {!draft.btcGiven ? ' (market price)' : ''}
                  </Text>
                )}
                {draft.stamp ? (
                  <View>
                    <Text style={styles.previewLabel}>
                      Signal then:{' '}
                      <Text style={[styles.stampText, { color: getSignalColor(draft.stamp.action) }]}>
                        {ACTION_LABEL[draft.stamp.action]}
                      </Text>
                    </Text>
                    <Text style={styles.previewLabel}>
                      {draft.stamp.dcaMultiplier}× DCA · conviction {draft.stamp.conviction}%
                      {draft.stamp.source === 'reconstructed' ? ' · replayed from that day' : ''}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.previewLabel}>
                    {when === 'now' ? 'Signal not loaded yet; the trade is saved without one.' : 'No signal for that date (before the available history).'}
                  </Text>
                )}
              </View>
            )}

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={styles.save} onPress={save} accessibilityRole="button">
              <Text style={styles.saveText}>Save {side}</Text>
            </Pressable>
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
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  title: { ...Typography.heading },
  cancel: { ...Typography.body, color: Colors.accent },
  label: { ...Typography.caption, color: Colors.textSecondary, marginTop: Spacing.md },
  hint: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17 },
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  flex: { flex: 1 },
  timeInput: { width: 90 },
  // Paper's segmented buttons have a minimum width each; two need about 150.
  ccy: { width: 150 },
  segBtn: { borderColor: Colors.cardBorder },
  input: {
    ...Typography.monoData, backgroundColor: Colors.elevated, borderRadius: BorderRadius.sm,
    borderWidth: 1, borderColor: Colors.cardBorder, paddingHorizontal: 12, paddingVertical: 10, color: Colors.textPrimary,
  },
  preview: { marginTop: Spacing.md, padding: Spacing.md, backgroundColor: Colors.elevated, borderRadius: BorderRadius.sm, gap: 6 },
  previewText: { ...Typography.monoData },
  previewLabel: { ...Typography.caption },
  stampText: { ...Typography.caption, fontWeight: '700' },
  error: { ...Typography.caption, color: Colors.bearish, marginTop: Spacing.sm },
  save: { marginTop: Spacing.lg, backgroundColor: Colors.accent, borderRadius: BorderRadius.sm, paddingVertical: 14, alignItems: 'center' },
  saveText: { ...Typography.body, color: '#000', fontWeight: '700' },
});
