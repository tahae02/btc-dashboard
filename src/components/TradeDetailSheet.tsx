import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InfoButton } from './InfoButton';
import { useData } from '../context/DataContext';
import { ExplainProvider } from '../context/ExplainContext';
import { tradeOutcomes, priceAt, type Trade, type PriceSeries } from '../services/journal';
import { ACTION_LABEL } from '../services/signalEngine';
import { ACTION_PLAIN } from '../services/plainEnglish';
import { formatMoney, formatBtc, formatPct, formatDateTime, isFlat } from '../services/format';
import { Colors, Typography, Spacing, BorderRadius, getSignalColor, getRegimeColor, Fonts } from '../constants/theme';

interface Props {
  trade: Trade | null;
  series: PriceSeries[];
  covered: boolean;
  onClose: () => void;
  onDelete: (t: Trade) => void;
}

const NOT_RECORDED = 'Not recorded';

const Row = ({ label, value, term, colour }: { label: string; value: string; term?: string; colour?: string }) => (
  <View style={styles.row}>
    <View style={styles.rowLabel}>
      <Text style={styles.label}>{label}</Text>
      {term ? <InfoButton term={term} size={14} /> : null}
    </View>
    <Text style={[styles.value, colour ? { color: colour } : null]}>{value}</Text>
  </View>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const pct = (v: number | null | undefined, digits = 1) => (v == null ? NOT_RECORDED : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);
/** -1..1 engine scores as a signed percentage, as the Signals tab shows them. */
const score = (v: number | null | undefined) => (v == null ? NOT_RECORDED : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`);
const moveColour = (v: number | null, good: boolean | null) =>
  v == null || isFlat(v) ? Colors.textSecondary : good ? Colors.bullish : Colors.bearish;

/**
 * Everything recorded about one trade: the order itself, the market at that
 * moment, what the app was saying, and what the price did afterwards.
 */
export const TradeDetailSheet = ({ trade, series, covered, onClose, onDelete }: Props) => {
  const data = useData();
  if (!trade) return null;
  const t = trade;
  const s = t.signal;
  const buy = t.side === 'buy';
  const effective = t.fiat / t.btc;
  const outcomes = tradeOutcomes(t, series);
  const entryUsd = t.marketPriceUsd ?? priceAt(t.time, series);
  const nowUsd = data.price?.price ?? null;
  const sinceThen = entryUsd && nowUsd ? nowUsd / entryUsd - 1 : null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      {/* Its own explanation sheet, mounted inside this one, so an (i) tapped
          here opens on top of the page rather than underneath it. */}
      <ExplainProvider>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{buy ? 'Buy' : 'Sell'} of {formatMoney(t.fiat, t.currency)}</Text>
              <Text style={styles.subtitle}>{formatDateTime(t.time)}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close trade details">
              <Ionicons name="close" size={24} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {covered && (
              <Text style={styles.covered}>Counted in your starting balance, so not added to your holdings again.</Text>
            )}

            <Section title="The order">
              <Row label={buy ? 'Total paid, fee included' : 'Total received, after fee'} value={formatMoney(t.fiat, t.currency)} />
              <Row label="Fee" value={t.fee > 0 ? formatMoney(t.fee, t.currency) : 'None entered'} />
              <Row label={buy ? 'BTC bought' : 'BTC sold'} value={`${formatBtc(t.btc)} BTC`} />
              <Row label="Exchange price per BTC" value={t.unitPrice != null ? formatMoney(t.unitPrice, t.currency) : NOT_RECORDED} />
              <Row label="Price per BTC with fee" value={formatMoney(effective, t.currency)} term="averageCost" />
              {t.note ? <Row label="Note" value={t.note} /> : null}
            </Section>

            <Section title="The market at the time">
              <Row label="BTC price in pounds" value={t.marketPriceGbp != null ? formatMoney(t.marketPriceGbp, 'GBP') : NOT_RECORDED} />
              <Row label="BTC price in dollars" value={t.marketPriceUsd != null ? formatMoney(t.marketPriceUsd, 'USD') : NOT_RECORDED} />
              <Row
                label="Fear & Greed"
                term="fearGreed"
                value={s?.fearGreed != null ? `${s.fearGreed}${s.fearGreedLabel ? ` (${s.fearGreedLabel})` : ''}` : NOT_RECORDED}
              />
              <Row label="RSI" term="rsi" value={s?.rsi != null ? s.rsi.toFixed(1) : NOT_RECORDED} />
              <Row label="Volatility (typical day)" term="atr" value={s?.atrPct != null ? `${s.atrPct.toFixed(1)}%` : NOT_RECORDED} />
              <Row label="200-day average" term="movingAverages" value={s?.sma200 != null ? formatMoney(s.sma200, 'USD') : NOT_RECORDED} />
              <Row label="Price vs 200-day average" value={pct(s?.priceVsSma200Pct)} />
            </Section>

            <Section title="What the app said">
              {s ? (
                <>
                  <View style={styles.row}>
                    <View style={styles.rowLabel}>
                      <Text style={styles.label}>Advice</Text>
                      <InfoButton term="action" size={14} />
                    </View>
                    <Text style={[styles.value, { color: getSignalColor(s.action), fontWeight: '700' }]}>{ACTION_LABEL[s.action]}</Text>
                  </View>
                  <Text style={styles.plain}>{ACTION_PLAIN[s.action]}</Text>
                  <Row
                    label="Market regime"
                    term="regime"
                    value={`${s.regime ?? ''}${s.regime ? ' ' : ''}${s.regimeScore >= 0 ? '+' : ''}${s.regimeScore}/3`}
                    colour={s.regime ? getRegimeColor(s.regime) : undefined}
                  />
                  <Row label="Conviction" term="conviction" value={`${s.conviction}%`} />
                  <Row label="Target allocation" term="targetAllocation" value={`${Math.round(s.targetAllocation * 100)}%`} />
                  <Row label="DCA multiplier" term="dcaMultiplier" value={`${s.dcaMultiplier}×`} />
                  <Row label="Price stretch" term="stretch" value={score(s.stretchScore)} />
                  <Row label="Momentum" term="momentum" value={score(s.momentumScore)} />
                  <Text style={styles.source}>
                    {s.source === 'live'
                      ? 'Recorded live: exactly what the app was showing when you logged this.'
                      : 'Replayed from that day\'s price history, because this trade was logged afterwards.'}
                  </Text>
                </>
              ) : (
                <Text style={styles.plain}>No signal was recorded for this trade.</Text>
              )}
            </Section>

            <Section title="What happened next">
              {outcomes.map((o) => (
                <Row
                  key={o.key}
                  label={`${o.days} day${o.days === 1 ? '' : 's'} later`}
                  value={o.change != null ? formatPct(o.change) : o.due > Date.now() ? `in ${Math.max(1, Math.ceil((o.due - Date.now()) / 86400000))} days` : '--'}
                  colour={o.change != null ? moveColour(o.change, o.favourable) : undefined}
                />
              ))}
              <Row
                label="Since then, to now"
                value={sinceThen != null ? formatPct(sinceThen) : '--'}
                colour={sinceThen != null ? moveColour(sinceThen, buy ? sinceThen > 0 : sinceThen < 0) : undefined}
              />
              <Text style={styles.source}>
                BTC's market price in dollars after the trade: green when it moved your way ({buy ? 'up after a buy' : 'down after a sell'}).
                The same move in pounds differs slightly, because the exchange rate moves too.
              </Text>
            </Section>

            <Pressable onPress={() => onDelete(t)} style={styles.delete} accessibilityRole="button">
              <Ionicons name="trash-outline" size={16} color={Colors.bearish} />
              <Text style={styles.deleteText}>Delete this trade</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
      </ExplainProvider>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    height: '92%', backgroundColor: Colors.background, borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.sm },
  title: { ...Typography.heading },
  subtitle: { ...Typography.caption, marginTop: 2 },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  covered: { ...Typography.caption, color: Colors.neutral, lineHeight: 17 },
  section: { backgroundColor: Colors.card, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.cardBorder, padding: Spacing.md },
  sectionTitle: { ...Typography.caption, color: Colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  label: { ...Typography.caption, color: Colors.textSecondary, fontSize: 13 },
  value: { ...Typography.monoData, fontSize: 13, textAlign: 'right', flexShrink: 1, fontFamily: Fonts.mono },
  plain: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 17, paddingVertical: 6 },
  source: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 17, marginTop: Spacing.sm },
  delete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.md },
  deleteText: { ...Typography.body, color: Colors.bearish },
});
