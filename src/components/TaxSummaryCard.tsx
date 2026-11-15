import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from './GlassCard';
import { taxSummary, type TaxYearSummary } from '../services/ukTax';
import { formatMoney } from '../services/format';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import type { LivePrices, OpeningPosition, Trade } from '../services/journal';

const yearText = (y: TaxYearSummary): string =>
  [
    `Tax year ${y.label} (6 April to 5 April)`,
    `Days with sales: ${y.disposals}`,
    `Sale proceeds (after fees): ${formatMoney(y.proceeds, 'GBP')}`,
    `Allowable costs (incl. buy fees): ${formatMoney(y.costs, 'GBP')}`,
    `Gains: ${formatMoney(y.gains, 'GBP')}   Losses: ${formatMoney(y.losses, 'GBP')}`,
    `Net gain: ${formatMoney(y.net, 'GBP', true)}`,
    `Tax-free allowance: ${formatMoney(y.allowance, 'GBP')}${y.allowanceKnown ? '' : ' (assumed)'}`,
    `Above the allowance: ${formatMoney(y.overAllowance, 'GBP')}`,
  ].join('\n');

/**
 * Gains for a UK tax return, by tax year, from the trades logged here. An
 * estimate to check against, not a tax calculation: see src/services/ukTax.ts.
 */
export const TaxSummaryCard = ({ trades, opening, live }: { trades: Trade[]; opening: OpeningPosition | null; live: LivePrices }) => {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => taxSummary(trades, opening, live), [trades, opening, live]);
  if (!trades.some((t) => t.side === 'sell')) return null;

  const share = async () => {
    const text = [
      'BTC Analyst: Bitcoin gains by UK tax year (estimate)',
      '',
      ...summary.years.map(yearText).flatMap((t) => [t, '']),
      'Worked out from the trades logged in the app, matched the HMRC way: same day, then the next 30 days, then the average-cost pool.',
    ].join('\n');
    try { await Share.share({ message: text, title: 'Bitcoin gains by tax year' }); } catch { /* dismissed */ }
  };

  return (
    <GlassCard>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.head} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={styles.title}>Gains for your tax return</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.accent} />
      </Pressable>
      {!open ? (
        <Text style={styles.closed}>
          {summary.years[0]
            ? `${summary.years[0].label}: net ${formatMoney(summary.years[0].net, 'GBP', true)} against a ${formatMoney(summary.years[0].allowance, 'GBP')} allowance.`
            : 'Gains and losses by UK tax year.'}
        </Text>
      ) : (
        <>
          {summary.years.map((y) => (
            <View key={y.startYear} style={styles.year}>
              <Text style={styles.yearTitle}>{y.label}</Text>
              {([
                ['Sale proceeds, after fees', formatMoney(y.proceeds, 'GBP')],
                ['What those coins cost', formatMoney(y.costs, 'GBP')],
                ['Net gain', formatMoney(y.net, 'GBP', true)],
                [`Tax-free allowance${y.allowanceKnown ? '' : ' (assumed)'}`, formatMoney(y.allowance, 'GBP')],
              ] as const).map(([label, value]) => (
                <View key={label} style={styles.row}>
                  <Text style={styles.label}>{label}</Text>
                  <Text style={styles.value}>{value}</Text>
                </View>
              ))}
              <View style={[styles.verdict, { backgroundColor: (y.overAllowance > 0 ? Colors.neutral : Colors.bullish) + '1F' }]}>
                <Text style={[styles.verdictText, { color: y.overAllowance > 0 ? Colors.neutral : Colors.bullish }]}>
                  {y.overAllowance > 0
                    ? `${formatMoney(y.overAllowance, 'GBP')} over the allowance: likely to need reporting.`
                    : 'Within the tax-free allowance.'}
                </Text>
              </View>
            </View>
          ))}
          <Text style={styles.note}>
            Matched the HMRC way: Bitcoin bought the same day first, then in the 30 days after, then the average
            cost of everything else. Buy fees count as costs; sale amounts are after fees. Dollar trades use the
            rate on their day.
            {summary.usesOpening ? ' Your starting balance counts as one average-cost holding.' : ''}
            {summary.unmatched ? ' More was sold than was logged as held, so some costs are missing.' : ''}
          </Text>
          <Text style={styles.note}>
            An estimate from the trades logged here, to check against. Other exchanges, transfers and spending
            Bitcoin count too. Check GOV.UK or an accountant before you file.
          </Text>
          <Pressable onPress={share} style={styles.shareBtn} accessibilityRole="button">
            <Ionicons name="share-outline" size={16} color={Colors.accent} />
            <Text style={styles.shareText}>Share as text</Text>
          </Pressable>
        </>
      )}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...Typography.subheading },
  closed: { ...Typography.caption, color: Colors.textSecondary, marginTop: Spacing.xs, lineHeight: 18 },
  year: { marginTop: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.cardBorder },
  yearTitle: { ...Typography.body, fontWeight: '700', marginBottom: Spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  label: { ...Typography.caption, fontSize: 14, color: Colors.textSecondary },
  value: { ...Typography.monoData },
  verdict: { borderRadius: BorderRadius.sm, padding: Spacing.sm, marginTop: Spacing.xs },
  verdictText: { ...Typography.caption, fontWeight: '600' },
  note: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18, marginTop: Spacing.md },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md, alignSelf: 'flex-start' },
  shareText: { ...Typography.body, color: Colors.accent, fontWeight: '600' },
});
