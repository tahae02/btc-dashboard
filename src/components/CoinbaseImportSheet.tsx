import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useData } from '../context/DataContext';
import { useJournal } from '../context/JournalContext';
import { fetchOHLCV, fetchFearGreedHistory } from '../services/api';
import { parseCoinbaseCsv, importedTradeId, isAlreadyLogged, type ImportResult } from '../services/coinbaseImport';
import { priceAt, serialiseBackup, type PriceSeries, type Trade } from '../services/journal';
import { reconstructStamp } from '../services/trackRecord';
import { TIMEFRAME_MS } from '../services/candles';
import { formatMoney, formatBtc, formatDate } from '../services/format';
import { Colors, Typography, Spacing, BorderRadius, Fonts } from '../constants/theme';
import type { FearGreedEntry, OHLCVCandle } from '../types';

/**
 * Paste a Coinbase transaction history (CSV) and log its Bitcoin buys and
 * sells in one go. Each one is recorded exactly like a back-dated trade: the
 * market price then in pounds and dollars, and the advice replayed from that
 * day. Rows already logged are left out, and importing the same file twice
 * adds nothing the second time.
 */
export const CoinbaseImportSheet = ({ visible, onClose }: { visible: boolean; onClose: () => void }) => {
  const data = useData();
  const journal = useJournal();
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [gbp, setGbp] = useState<{ hourly: OHLCVCandle[]; daily: OHLCVCandle[] } | null>(null);
  const [fg, setFg] = useState<FearGreedEntry[] | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setText('');
    setResult(null);
    setDone(null);
  }, [visible]);

  // History for pricing and replaying the advice, fetched once there is something to import.
  const { loadTimeframe } = data;
  const ready = result != null && result.trades.length > 0;
  useEffect(() => {
    if (!ready) return;
    if (!data.ohlcv['1H'].length) loadTimeframe('1H');
    let cancelled = false;
    if (!gbp) {
      Promise.allSettled([fetchOHLCV('1H', 'GBP'), fetchOHLCV('1D', 'GBP')]).then(([h, d]) => {
        if (!cancelled) setGbp({ hourly: h.status === 'fulfilled' ? h.value : [], daily: d.status === 'fulfilled' ? d.value : [] });
      });
    }
    if (!fg) {
      fetchFearGreedHistory()
        .then((h) => { if (!cancelled) setFg(h); })
        .catch(() => { if (!cancelled) setFg(data.fearGreed?.history ?? []); });
    }
    return () => { cancelled = true; };
  }, [ready, gbp, fg, data.ohlcv, data.fearGreed, loadTimeframe]);

  const fresh = useMemo(
    () => (result ? result.trades.filter((t) => !isAlreadyLogged(t, journal.trades)) : []),
    [result, journal.trades]
  );

  const doImport = () => {
    const usd: PriceSeries[] = [
      { candles: data.ohlcv['1H'], intervalMs: TIMEFRAME_MS['1H'] },
      { candles: data.ohlcv['1D'], intervalMs: TIMEFRAME_MS['1D'] },
    ];
    const pounds: PriceSeries[] = gbp
      ? [{ candles: gbp.hourly, intervalMs: TIMEFRAME_MS['1H'] }, { candles: gbp.daily, intervalMs: TIMEFRAME_MS['1D'] }]
      : [];
    const now = Date.now();
    const trades: Trade[] = fresh.map((t) => {
      const marketUsd = priceAt(t.time, usd) ?? (t.currency === 'USD' ? t.unitPrice : null);
      const marketGbp = priceAt(t.time, pounds) ?? (t.currency === 'GBP' ? t.unitPrice : null);
      return {
        id: importedTradeId(t),
        side: t.side,
        time: t.time,
        fiat: t.fiat,
        currency: t.currency,
        btc: t.btc,
        unitPrice: t.unitPrice,
        fee: t.fee,
        marketPriceUsd: marketUsd,
        marketPriceGbp: marketGbp,
        signal: reconstructStamp(journal.closedDaily, t.time, journal.config, fg ?? []),
        note: 'Imported from Coinbase',
        createdAt: now,
      };
    });
    const r = journal.restore(serialiseBackup(trades));
    setDone(`${r.trades} trade${r.trades === 1 ? '' : 's'} imported. Each has the market price and the advice from its day.`);
  };

  const buys = fresh.filter((t) => t.side === 'buy');
  const sells = fresh.filter((t) => t.side === 'sell');
  const loading = ready && (gbp == null || fg == null);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Import from Coinbase</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
                <Text style={styles.cancel}>{done ? 'Done' : 'Cancel'}</Text>
              </Pressable>
            </View>

            {done ? (
              <Text style={styles.body}>{done}</Text>
            ) : (
              <>
                <View style={styles.steps}>
                  {[
                    'On Coinbase: Profile, Statements (or Reports), Generate a transaction history as CSV.',
                    'Open the file, select all the text, and copy it.',
                    'Paste it below and tap Check.',
                  ].map((s, i) => (
                    <View key={s} style={styles.step}>
                      <Text style={styles.stepNum}>{i + 1}</Text>
                      <Text style={styles.stepText}>{s}</Text>
                    </View>
                  ))}
                </View>
                <TextInput
                  style={styles.input}
                  value={text}
                  onChangeText={(v) => { setText(v); setResult(null); }}
                  placeholder="Paste the CSV text here"
                  placeholderTextColor={Colors.textTertiary}
                  multiline
                />
                <Pressable style={styles.btn} onPress={() => setResult(parseCoinbaseCsv(text))} accessibilityRole="button">
                  <Text style={styles.btnText}>Check</Text>
                </Pressable>

                {result?.error && <Text style={styles.error}>{result.error}</Text>}
                {result && !result.error && (
                  <View style={styles.preview}>
                    <Text style={styles.previewText}>
                      Found {result.trades.length} Bitcoin trade{result.trades.length === 1 ? '' : 's'}
                      {result.trades.length - fresh.length > 0 ? `, ${result.trades.length - fresh.length} already logged` : ''}.
                      {result.skipped > 0 ? ` ${result.skipped} other row${result.skipped === 1 ? '' : 's'} (sends, other coins, other currencies) left out.` : ''}
                    </Text>
                    {fresh.length > 0 && (
                      <>
                        <Text style={styles.previewText}>
                          To import: {buys.length} buy{buys.length === 1 ? '' : 's'} ({formatMoney(buys.reduce((n, t) => n + (t.currency === 'GBP' ? t.fiat : 0), 0), 'GBP')} in pounds
                          {buys.some((t) => t.currency === 'USD') ? ', plus some in dollars' : ''}) and {sells.length} sell{sells.length === 1 ? '' : 's'},{' '}
                          {formatDate(fresh[0]!.time)} to {formatDate(fresh[fresh.length - 1]!.time)}.
                        </Text>
                        {fresh.slice(-3).reverse().map((t) => (
                          <Text key={importedTradeId(t)} style={styles.row}>
                            {formatDate(t.time)}  {t.side === 'buy' ? 'Buy' : 'Sell'} {formatBtc(t.btc)} BTC for {formatMoney(t.fiat, t.currency)}
                          </Text>
                        ))}
                        {journal.opening && fresh.some((t) => t.time <= journal.opening!.time) && (
                          <Text style={styles.hint}>
                            Trades on or before your starting balance are logged for the record but not added to your
                            holdings again.
                          </Text>
                        )}
                        <Pressable style={[styles.btn, loading && styles.btnWait]} onPress={doImport} disabled={loading} accessibilityRole="button">
                          {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.btnText}>Import {fresh.length} trade{fresh.length === 1 ? '' : 's'}</Text>}
                        </Pressable>
                      </>
                    )}
                  </View>
                )}
              </>
            )}
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
  body: { ...Typography.body, color: Colors.textSecondary, lineHeight: 22 },
  steps: { gap: Spacing.sm },
  step: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  stepNum: { ...Typography.caption, color: '#000', backgroundColor: Colors.accent, width: 20, height: 20, borderRadius: 10, textAlign: 'center', lineHeight: 20, fontWeight: '700' },
  stepText: { ...Typography.caption, fontSize: 14, color: Colors.textSecondary, flex: 1, lineHeight: 20 },
  input: {
    ...Typography.caption, fontFamily: Fonts.mono, color: Colors.textPrimary, backgroundColor: Colors.elevated, marginTop: Spacing.sm,
    borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.cardBorder, padding: 10, minHeight: 110, maxHeight: 200, textAlignVertical: 'top',
  },
  btn: { marginTop: Spacing.sm, backgroundColor: Colors.accent, borderRadius: BorderRadius.sm, paddingVertical: 12, alignItems: 'center' },
  btnWait: { opacity: 0.6 },
  btnText: { ...Typography.body, fontWeight: '700', color: '#000' },
  error: { ...Typography.caption, color: Colors.bearish, marginTop: Spacing.sm, lineHeight: 18 },
  preview: { marginTop: Spacing.md, padding: Spacing.md, backgroundColor: Colors.elevated, borderRadius: BorderRadius.sm, gap: 6 },
  previewText: { ...Typography.caption, fontSize: 14, color: Colors.textPrimary, lineHeight: 20 },
  row: { ...Typography.caption, color: Colors.textSecondary },
  hint: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18 },
});
