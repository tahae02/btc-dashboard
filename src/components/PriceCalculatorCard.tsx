import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import type { Currency } from '../types';
import { GlassCard } from './GlassCard';
import { InfoButton } from './InfoButton';
import { PriceSlider } from './PriceSlider';
import {
  CALCULATOR_KEY, DEFAULT_CALCULATOR, PRESET_PRICES, parseCalculatorState, defaultTarget, convertTarget, nudgePrice,
  parsePriceInput, project, btcForAmount, shortPrice, type CalculatorState,
} from '../services/calculator';
import { parseAmount, type LivePrices } from '../services/journal';
import { formatMoney, formatBtc, formatPct, isFlat } from '../services/format';
import { Colors, Typography, Spacing, BorderRadius, Fonts } from '../constants/theme';

const gainColour = (n: number | null) => (n == null || isFlat(n) ? Colors.textSecondary : n > 0 ? Colors.bullish : Colors.bearish);
/** The number without its currency symbol, for the editable price. */
const bare = (n: number, c: Currency) => formatMoney(n, c).slice(1);

interface Props {
  /** What you hold and what it cost, or null with nothing logged. */
  holdings: { btc: number; costGbp: number } | null;
  live: LivePrices;
  onDragChange?: (dragging: boolean) => void;
}

/**
 * "What if Bitcoin hits…": pick a price, see what your Bitcoin (or an amount
 * you type) would be worth, in pounds and dollars, with the percentage.
 * Arithmetic on a price you choose, not a forecast.
 */
export const PriceCalculatorCard = ({ holdings, live, onDragChange }: Props) => {
  const [state, setState] = useState<CalculatorState>(DEFAULT_CALCULATOR);
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
  const [amountDraft, setAmountDraft] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(CALCULATOR_KEY)
      .then((raw) => setState(parseCalculatorState(raw)))
      .catch(() => {})
      .finally(() => { loaded.current = true; });
  }, []);

  // Saved shortly after the last change, not on every step of a drag.
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => AsyncStorage.setItem(CALCULATOR_KEY, JSON.stringify(state)).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [state]);

  const hasPrice = live.usd > 0 && live.gbp > 0;
  const ccy = state.currency;
  const other: Currency = ccy === 'USD' ? 'GBP' : 'USD';
  const today = ccy === 'USD' ? live.usd : live.gbp;
  const target = state.target ?? defaultTarget(hasPrice ? today : null);
  const hasHoldings = holdings != null && holdings.btc > 0;
  const basis = hasHoldings ? state.basis : 'amount';

  const update = (partial: Partial<CalculatorState>) => setState((s) => ({ ...s, ...partial }));
  const setTarget = (p: number) => update({ target: p });
  const switchCurrency = (to: Currency) => {
    if (to === ccy) return;
    setPriceDraft(null);
    update({ currency: to, target: state.target == null ? null : convertTarget(state.target, ccy, to, live) });
  };

  const btc = basis === 'holdings' ? holdings?.btc ?? 0 : state.amount ? btcForAmount(state.amount, state.amountCurrency, live) : 0;
  const paid = basis === 'holdings' ? holdings?.costGbp ?? null : state.amount;
  const paidCurrency: Currency = basis === 'holdings' ? 'GBP' : state.amountCurrency;
  const p = hasPrice && btc > 0 ? project({ btc, paid, paidCurrency, target, targetCurrency: ccy, live }) : null;

  return (
    <GlassCard>
      <View style={styles.titleRow}>
        <Text style={styles.sectionTitle}>What if Bitcoin hits…</Text>
        <InfoButton term="priceCalculator" />
      </View>

      <View style={styles.segment}>
        {(['USD', 'GBP'] as const).map((c) => (
          <Pressable
            key={c}
            onPress={() => switchCurrency(c)}
            style={[styles.segBtn, ccy === c && styles.segOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: ccy === c }}
          >
            <Text style={[styles.segText, ccy === c && styles.segTextOn]}>{c === 'USD' ? '$ Dollars' : '£ Pounds'}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.priceRow}>
        <Pressable onPress={() => setTarget(nudgePrice(target, -1))} hitSlop={8} style={styles.stepBtn} accessibilityLabel="Lower price">
          <Ionicons name="remove" size={20} color={Colors.textPrimary} />
        </Pressable>
        <TextInput
          style={styles.priceInput}
          value={priceDraft ?? formatMoney(target, ccy)}
          onFocus={() => setPriceDraft(String(Math.round(target)))}
          onChangeText={(t) => {
            setPriceDraft(t);
            const n = parsePriceInput(t);
            if (n != null) setTarget(n);
          }}
          onBlur={() => setPriceDraft(null)}
          keyboardType="numeric"
          selectTextOnFocus
          accessibilityLabel="Bitcoin price to work out"
        />
        <Pressable onPress={() => setTarget(nudgePrice(target, 1))} hitSlop={8} style={styles.stepBtn} accessibilityLabel="Raise price">
          <Ionicons name="add" size={20} color={Colors.textPrimary} />
        </Pressable>
      </View>
      {hasPrice && (
        <Text style={styles.priceSub}>
          {formatMoney(convertTarget(target, ccy, other, live), other)} in {other === 'GBP' ? 'pounds' : 'dollars'}
          {' · '}
          <Text style={{ color: gainColour(target / today - 1) }}>{formatPct(target / today - 1)}</Text> from today's{' '}
          {formatMoney(today, ccy)}
        </Text>
      )}

      <View style={styles.sliderWrap}>
        <PriceSlider value={target} currency={ccy} today={hasPrice ? today : null} onChange={setTarget} onDragChange={onDragChange} />
      </View>
      {hasPrice && (
        <View style={styles.legendRow}>
          <View style={styles.todayDot} />
          <Text style={styles.legend}>Today's price</Text>
        </View>
      )}

      <View style={styles.chips}>
        {PRESET_PRICES.map((v) => (
          <Pressable
            key={v}
            onPress={() => { setPriceDraft(null); setTarget(v); }}
            style={[styles.chip, target === v && styles.chipOn]}
            accessibilityRole="button"
          >
            <Text style={[styles.chipText, target === v && styles.chipTextOn]}>{shortPrice(v, ccy)}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.divider} />

      {hasHoldings && (
        <View style={[styles.segment, { marginBottom: Spacing.md }]}>
          {([['holdings', 'My Bitcoin'], ['amount', 'An amount']] as const).map(([b, label]) => (
            <Pressable
              key={b}
              onPress={() => update({ basis: b })}
              style={[styles.segBtn, basis === b && styles.segOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: basis === b }}
            >
              <Text style={[styles.segText, basis === b && styles.segTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {basis === 'holdings' && holdings ? (
        <Text style={styles.basisText}>
          Your {formatBtc(holdings.btc)} BTC
          {holdings.costGbp > 0 ? `, which cost ${formatMoney(holdings.costGbp, 'GBP')}` : ''}.
        </Text>
      ) : (
        <View>
          <Text style={styles.basisText}>If you put in</Text>
          <View style={styles.amountRow}>
            <View style={styles.amountBox}>
              <Text style={styles.amountSym}>{state.amountCurrency === 'GBP' ? '£' : '$'}</Text>
              <TextInput
                style={styles.amountInput}
                value={amountDraft ?? (state.amount != null ? bare(state.amount, state.amountCurrency) : '')}
                onFocus={() => setAmountDraft(state.amount != null ? String(state.amount) : '')}
                onChangeText={(t) => {
                  setAmountDraft(t);
                  const n = parseAmount(t);
                  update({ amount: n != null && n > 0 ? n : null });
                }}
                onBlur={() => setAmountDraft(null)}
                placeholder="8,100"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="decimal-pad"
                accessibilityLabel="Amount to put in"
              />
            </View>
            {(['GBP', 'USD'] as const).map((c) => (
              <Pressable
                key={c}
                onPress={() => update({ amountCurrency: c })}
                style={[styles.ccyPill, state.amountCurrency === c && styles.segOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: state.amountCurrency === c }}
              >
                <Text style={[styles.segText, state.amountCurrency === c && styles.segTextOn]}>{c === 'GBP' ? '£' : '$'}</Text>
              </Pressable>
            ))}
          </View>
          {hasPrice && state.amount != null && (
            <Text style={styles.basisSub}>
              Buys {formatBtc(Number(btc.toFixed(8)))} BTC at today's price, before fees.
            </Text>
          )}
        </View>
      )}

      {!hasPrice ? (
        <Text style={styles.note}>Waiting for today's price…</Text>
      ) : !p ? (
        <Text style={styles.note}>Type an amount to see what it would be worth.</Text>
      ) : (
        <View style={styles.result}>
          <Text style={styles.label}>Would be worth at {formatMoney(target, ccy)}</Text>
          <View style={styles.pairRow}>
            {(['GBP', 'USD'] as const).map((c) => (
              <View key={c} style={styles.pairCell}>
                <Text style={styles.valueBig} numberOfLines={1} adjustsFontSizeToFit>
                  {formatMoney(p.worth[c], c)}
                </Text>
                {p.gain && (
                  <Text style={[styles.gain, { color: gainColour(p.gainPct) }]} numberOfLines={1} adjustsFontSizeToFit>
                    {formatMoney(p.gain[c], c, true)}
                  </Text>
                )}
              </View>
            ))}
          </View>
          {p.gainPct != null && (
            <Text style={[styles.pctBig, { color: gainColour(p.gainPct) }]}>
              {formatPct(p.gainPct)} <Text style={styles.pctLabel}>on the {formatMoney(paid ?? 0, paidCurrency)} you {basis === 'holdings' ? 'paid' : 'put in'}</Text>
            </Text>
          )}
          {basis === 'holdings' && (
            <Text style={styles.basisSub}>
              Worth {formatMoney(p.worthToday.GBP, 'GBP')} ({formatMoney(p.worthToday.USD, 'USD')}) at today's price.
            </Text>
          )}
        </View>
      )}

      <Text style={styles.note}>
        A what-if, not a forecast. Pounds and dollars convert at today's exchange rate, and fees and tax are not taken off.
      </Text>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  sectionTitle: { ...Typography.subheading },
  segment: { flexDirection: 'row', backgroundColor: Colors.elevated, borderRadius: BorderRadius.sm, padding: 3, gap: 3 },
  segBtn: { flex: 1, paddingVertical: 7, borderRadius: BorderRadius.sm - 2, alignItems: 'center' },
  segOn: { backgroundColor: Colors.accent },
  segText: { ...Typography.caption, fontWeight: '600', color: Colors.textSecondary, fontSize: 13 },
  segTextOn: { color: '#000' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.lg },
  stepBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  priceInput: { ...Typography.priceDisplay, fontSize: 30, padding: 0, flex: 1, minWidth: 0, textAlign: 'center' },
  priceSub: { ...Typography.caption, textAlign: 'center', marginTop: 4 },
  sliderWrap: { marginTop: Spacing.md },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  todayDot: { width: 3, height: 12, borderRadius: 1.5, backgroundColor: Colors.neutral },
  legend: { ...Typography.caption, fontSize: 11, color: Colors.textTertiary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Spacing.md },
  chip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: BorderRadius.pill,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  chipOn: { backgroundColor: Colors.accent + '26', borderColor: Colors.accent },
  chipText: { ...Typography.caption, fontFamily: Fonts.mono, color: Colors.textSecondary },
  chipTextOn: { color: Colors.accent, fontWeight: '700' },
  divider: { height: 1, backgroundColor: Colors.cardBorder, marginVertical: Spacing.lg },
  basisText: { ...Typography.body, fontSize: 15, color: Colors.textSecondary },
  basisSub: { ...Typography.caption, color: Colors.textTertiary, marginTop: Spacing.sm },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  amountBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.elevated,
    borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.cardBorder, paddingHorizontal: 10,
  },
  amountSym: { ...Typography.monoData, fontSize: 18, color: Colors.textSecondary },
  amountInput: { ...Typography.monoData, fontSize: 18, flex: 1, paddingVertical: 8, paddingHorizontal: 4 },
  ccyPill: { width: 40, paddingVertical: 9, borderRadius: BorderRadius.sm, alignItems: 'center', backgroundColor: Colors.elevated },
  result: { marginTop: Spacing.lg },
  label: { ...Typography.caption },
  pairRow: { flexDirection: 'row', gap: Spacing.md, marginTop: 2 },
  pairCell: { flex: 1 },
  valueBig: { ...Typography.priceDisplay, fontSize: 24 },
  gain: { ...Typography.monoData, fontSize: 14, marginTop: 2 },
  pctBig: { ...Typography.monoData, fontSize: 20, fontWeight: '700', marginTop: Spacing.md },
  pctLabel: { ...Typography.caption, fontWeight: '400', color: Colors.textSecondary },
  note: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, marginTop: Spacing.md },
});
