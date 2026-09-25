import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import { useData } from '../context/DataContext';
import { useJournal } from '../context/JournalContext';
import { useSettings } from '../context/SettingsContext';
import { parseOpeningForm, convert } from '../services/journal';
import { formatMoney, formatBtc, formatDateTime, currencySymbol } from '../services/format';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import type { Currency } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * "I already own some Bitcoin": what you have put in altogether and how much
 * BTC you hold now. Everything else (average cost in both currencies, profit
 * or loss) is worked out from those two numbers.
 */
export const OpeningSheet = ({ visible, onClose }: Props) => {
  const data = useData();
  const settings = useSettings();
  const journal = useJournal();
  const existing = journal.opening;

  const [invested, setInvested] = useState('');
  const [btc, setBtc] = useState('');
  const [currency, setCurrency] = useState<Currency>(settings.currency);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setInvested(existing ? String(existing.invested) : '');
    setBtc(existing ? String(existing.btc) : '');
    setCurrency(existing?.currency ?? settings.currency);
    setError(null);
  }, [visible, existing, settings.currency]);

  const live = { usd: data.price?.price ?? 0, gbp: data.price?.price_gbp ?? 0 };
  // Editing keeps the original date, so trades logged since stay counted.
  const time = existing?.time ?? Date.now();
  const parsed = useMemo(() => parseOpeningForm({ invested, btc, currency }, time), [invested, btc, currency, time]);

  const avg = parsed.ok ? parsed.opening.invested / parsed.opening.btc : null;
  const other: Currency = currency === 'GBP' ? 'USD' : 'GBP';
  const avgOther = avg != null && live.usd > 0 && live.gbp > 0 ? convert(avg, currency, other, live) : null;
  const nowPrice = currency === 'GBP' ? live.gbp : live.usd;

  const save = () => {
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    journal.setOpening(parsed.opening);
    onClose();
  };

  const remove = () => {
    Alert.alert('Remove your starting balance?', 'Logged trades are kept. Your holdings will then count logged trades only.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { journal.setOpening(null); onClose(); } },
    ]);
  };

  const sym = currencySymbol(currency);
  const typed = invested.trim() !== '' || btc.trim() !== '';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{existing ? 'Your starting balance' : 'Bitcoin you already own'}</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              Enter what you hold now and what you have put in altogether. You do not need to log every past order.
              Your exchange shows both: on Coinbase, your BTC balance is on the Bitcoin page, and the total you have
              put in is the sum of your buys.
            </Text>

            <View style={[styles.row, { marginTop: Spacing.md }]}>
              <Text style={[styles.label, styles.flex]}>Currency you bought in</Text>
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

            <Text style={styles.label}>Total put in, fees included</Text>
            <TextInput
              style={styles.input}
              value={invested}
              onChangeText={(v) => { setInvested(v); setError(null); }}
              placeholder={`${sym}0.00`}
              keyboardType="decimal-pad"
              placeholderTextColor={Colors.textTertiary}
              accessibilityLabel="Total put in"
            />

            <Text style={styles.label}>BTC you hold now</Text>
            <TextInput
              style={styles.input}
              value={btc}
              onChangeText={(v) => { setBtc(v); setError(null); }}
              placeholder="0.00000000"
              keyboardType="decimal-pad"
              placeholderTextColor={Colors.textTertiary}
              accessibilityLabel="BTC held"
            />

            {parsed.ok && avg != null && (
              <View style={styles.preview}>
                <Text style={styles.previewLabel}>Your average cost</Text>
                <Text style={styles.previewBig}>{formatMoney(avg, currency)} per BTC</Text>
                {avgOther != null && (
                  <Text style={styles.previewLabel}>
                    {formatMoney(avgOther, other)} per BTC in {other === 'USD' ? 'dollars' : 'pounds'}, at today's exchange rate
                  </Text>
                )}
                {nowPrice > 0 && (
                  <Text style={[styles.previewLabel, { marginTop: 6 }]}>
                    Worth {formatMoney(parsed.opening.btc * nowPrice, currency)} today ({formatBtc(parsed.opening.btc)} BTC at{' '}
                    {formatMoney(nowPrice, currency)}).
                  </Text>
                )}
              </View>
            )}

            <Text style={styles.hint}>
              {existing
                ? `Set on ${formatDateTime(existing.time)}. Trades dated before then are treated as already included, so they are never counted twice.`
                : 'From now on, log new buys and sells as you make them. Any older order you log later is treated as already included here, so nothing is counted twice.'}
            </Text>

            {(error ?? (!parsed.ok && typed ? parsed.error : null)) && (
              <Text style={styles.error}>{error ?? (!parsed.ok ? parsed.error : '')}</Text>
            )}

            <Pressable style={styles.save} onPress={save} accessibilityRole="button">
              <Text style={styles.saveText}>{existing ? 'Save changes' : 'Save starting balance'}</Text>
            </Pressable>
            {existing && (
              <Pressable onPress={remove} style={styles.removeBtn} accessibilityRole="button">
                <Text style={styles.remove}>Remove starting balance</Text>
              </Pressable>
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
  title: { ...Typography.heading, flex: 1 },
  cancel: { ...Typography.body, color: Colors.accent },
  label: { ...Typography.caption, color: Colors.textSecondary, marginTop: Spacing.md },
  hint: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17 },
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  flex: { flex: 1 },
  ccy: { width: 150 },
  segBtn: { borderColor: Colors.cardBorder },
  input: {
    ...Typography.monoData, backgroundColor: Colors.elevated, borderRadius: BorderRadius.sm,
    borderWidth: 1, borderColor: Colors.cardBorder, paddingHorizontal: 12, paddingVertical: 10, color: Colors.textPrimary,
  },
  preview: { marginVertical: Spacing.md, padding: Spacing.md, backgroundColor: Colors.elevated, borderRadius: BorderRadius.sm, gap: 2 },
  previewLabel: { ...Typography.caption },
  previewBig: { ...Typography.monoData, fontSize: 18 },
  error: { ...Typography.caption, color: Colors.bearish, marginTop: Spacing.sm },
  save: { marginTop: Spacing.lg, backgroundColor: Colors.accent, borderRadius: BorderRadius.sm, paddingVertical: 14, alignItems: 'center' },
  saveText: { ...Typography.body, color: '#000', fontWeight: '700' },
  removeBtn: { alignItems: 'center', paddingVertical: Spacing.md },
  remove: { ...Typography.body, color: Colors.bearish },
});
