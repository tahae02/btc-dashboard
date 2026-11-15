import React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { useData } from '../../src/context/DataContext';
import { useSettings } from '../../src/context/SettingsContext';
import { GlassCard } from '../../src/components/GlassCard';
import { FearGreedGauge } from '../../src/components/FearGreedGauge';
import { SkeletonLoader } from '../../src/components/SkeletonLoader';
import { Colors, Typography, Spacing, Numbers, Fonts } from '../../src/constants/theme';
import { IS_WEB } from '../../src/services/api';
import { fearGreedColor } from '../../src/services/gauge';
import { formatCompactMoney } from '../../src/services/format';
import { InfoButton } from '../../src/components/InfoButton';
import type { FearGreedEntry } from '../../src/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (seconds: string): string => {
  const d = new Date(Number(seconds) * 1000);
  return Number.isFinite(d.getTime()) ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : '';
};

const formatHashRate = (h: number): string => {
  if (!h) return '--';
  if (h >= 1e18) return `${(h / 1e18).toFixed(0)} EH/s`;
  if (h >= 1e15) return `${(h / 1e15).toFixed(0)} PH/s`;
  if (h >= 1e12) return `${(h / 1e12).toFixed(0)} TH/s`;
  return `${h.toFixed(0)} H/s`;
};

const getCongestion = (count: number): { label: string; color: string } => {
  if (count < 10000) return { label: 'Low', color: Colors.bullish };
  if (count < 50000) return { label: 'Medium', color: Colors.neutral };
  return { label: 'High', color: Colors.bearish };
};

/** The last 30 days of Fear & Greed as bars, with a 0, 50, 100 scale, dates, and today marked. */
const FearGreedHistory = ({ history, width }: { history: FearGreedEntry[]; width: number }) => {
  const days = history.slice(0, 30).reverse(); // oldest first
  const AXIS = 26;
  const H = 96;
  const DATE_H = 16;
  const W = Math.max(120, width - AXIS);
  const slot = W / Math.max(1, days.length);
  const y = (v: number) => (1 - Math.max(0, Math.min(100, v)) / 100) * H;
  const last = days.length - 1;
  return (
    <Svg width={W + AXIS} height={H + DATE_H + 4}>
      {[0, 50, 100].map((v) => (
        <React.Fragment key={v}>
          <Line x1={0} x2={W} y1={y(v)} y2={y(v)} stroke={Colors.cardBorder} strokeWidth={1} />
          <SvgText fontFamily={Fonts.system} x={W + 5} y={y(v) + (v === 100 ? 9 : v === 0 ? -2 : 3.5)} fill={Colors.textTertiary} fontSize={10}>
            {String(v)}
          </SvgText>
        </React.Fragment>
      ))}
      {days.map((e, i) => {
        const v = Number.isFinite(e?.value) ? e.value : 50;
        const today = i === last;
        return (
          <Rect
            key={i}
            x={i * slot + 1}
            y={y(v)}
            width={Math.max(1, slot - 2)}
            height={H - y(v)}
            rx={1.5}
            fill={fearGreedColor(v)}
            fillOpacity={today ? 1 : 0.55}
            stroke={today ? Colors.textPrimary : 'none'}
            strokeWidth={today ? 1.5 : 0}
          />
        );
      })}
      {days.length > 1 && (
        <>
          <SvgText fontFamily={Fonts.system} x={0} y={H + DATE_H} fill={Colors.textTertiary} fontSize={10}>
            {shortDate(days[0]!.timestamp)}
          </SvgText>
          <SvgText fontFamily={Fonts.system} x={last * slot + slot / 2} y={H + DATE_H} fill={Colors.textPrimary} fontSize={10} fontWeight="600" textAnchor="end">
            {`Today ${days[last]!.value}`}
          </SvgText>
        </>
      )}
    </Svg>
  );
};

export default function MarketScreen() {
  const data = useData();
  const settings = useSettings();
  const fg = data?.fearGreed;
  const oc = data?.onChain;
  const price = data?.price;

  const fgHistory = fg?.history ?? [];
  const yesterday = fgHistory?.[1];
  const lastWeek = fgHistory?.[7];
  const lastMonth = fgHistory?.[30] ?? fgHistory?.[fgHistory.length - 1];

  const congestion = getCongestion(oc?.mempool?.count ?? 0);
  // Market size in your chosen currency, at today's rate (both figures are today's).
  const ccy = settings.currency;
  const fx = ccy === 'GBP' && price?.price && price?.price_gbp ? price.price_gbp / price.price : 1;
  const money = (n: number | null | undefined) => (n == null || !Number.isFinite(n) || n <= 0 ? '--' : formatCompactMoney(n * fx, ccy));

  if (data?.isLoading && !price) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <SkeletonLoader width="100%" height={200} />
          {[1, 2, 3, 4].map(i => <SkeletonLoader key={i} width="100%" height={80} style={{ marginTop: Spacing.md }} />)}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Market</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={data?.isLoading ?? false} onRefresh={() => data?.refresh?.()} tintColor={Colors.accent} />}
      >
        {/* Mood */}
        <View style={styles.headerRow}>
          <Text style={[styles.sectionHeader, { marginTop: 0 }]}>Mood: Fear &amp; Greed</Text>
          <InfoButton term="fearGreed" size={20} />
        </View>
        <Text style={styles.plainNote}>
          How nervous (0) or excited (100) crypto investors are. Extreme fear has more often come near low points and
          extreme greed near peaks, but it can stay extreme for weeks.
        </Text>
        {fg ? (
          <GlassCard style={styles.gaugeCard}>
            <FearGreedGauge value={fg?.current?.value ?? 50} label={fg?.current?.value_classification ?? 'Neutral'} size={220} />
            <View style={styles.fgHistoryRow}>
              {[
                { label: 'Yesterday', entry: yesterday },
                { label: 'Last week', entry: lastWeek },
                { label: 'Last month', entry: lastMonth },
              ].map((item, i) => (
                <View key={i} style={styles.fgHistoryCol}>
                  <Text style={styles.fgHistLabel}>{item.label}</Text>
                  <Text style={styles.fgHistValue}>{item?.entry?.value ?? '--'}</Text>
                  <Text style={styles.fgHistClass}>{item?.entry?.value_classification ?? '--'}</Text>
                </View>
              ))}
            </View>
          </GlassCard>
        ) : (
          <GlassCard>
            <Text style={styles.plainNote}>
              Fear &amp; Greed did not load. {data?.failedSources?.find((s) => s.startsWith('Fear')) ?? ''}
            </Text>
          </GlassCard>
        )}

        {fgHistory.length > 1 && (
          <GlassCard>
            <Text style={styles.cardTitle}>The last 30 days</Text>
            <FearGreedHistory history={fgHistory} width={Dimensions.get('window').width - 32 - 32} />
          </GlassCard>
        )}

        {/* Market size */}
        <Text style={styles.sectionHeader}>Market size</Text>
        <Text style={styles.plainNote}>The size of the market and how much is being traded.</Text>
        <GlassCard>
          <View style={styles.statRow}>
            <View style={styles.labelRow}>
              <Text style={styles.statLabel}>Market cap</Text>
              <InfoButton term="marketCap" />
            </View>
            <Text style={styles.statValue}>{money(price?.market_cap)}</Text>
          </View>
        </GlassCard>
        <GlassCard>
          <View style={styles.statRow}>
            <View style={styles.labelRow}>
              <Text style={styles.statLabel}>24h volume</Text>
              <InfoButton term="volume" />
            </View>
            <Text style={styles.statValue}>{money(price?.volume_24h)}</Text>
          </View>
        </GlassCard>
        <GlassCard>
          <View style={styles.statRow}>
            <View style={styles.labelRow}>
              <Text style={styles.statLabel}>BTC dominance</Text>
              <InfoButton term="dominance" />
            </View>
            <Text style={styles.statValue}>{data?.btcDominance != null ? `${data.btcDominance.toFixed(1)}%` : '--'}</Text>
          </View>
        </GlassCard>
        <GlassCard>
          <View style={styles.statRow}>
            <View style={styles.labelRow}>
              <Text style={styles.statLabel}>Coins in circulation</Text>
              <InfoButton term="supply" />
            </View>
            <Text style={styles.statValue}>
              {price?.circulating_supply != null
                ? `${(price.circulating_supply / 1e6).toFixed(2)}M (${((price.circulating_supply / 21e6) * 100).toFixed(1)}%)`
                : '--'}
            </Text>
          </View>
        </GlassCard>

        {/* Network */}
        <Text style={styles.sectionHeader}>Network (on-chain)</Text>
        <Text style={styles.plainNote}>
          How busy and secure the Bitcoin network is. These describe the network&apos;s health; they are not price signals.
        </Text>
        {IS_WEB && (
          <GlassCard style={styles.webNotice}>
            <Text style={styles.webNoticeText}>
              Live network figures (hash rate, mempool, fees) load in the installed phone app. A web browser cannot fetch them.
            </Text>
          </GlassCard>
        )}
        <GlassCard>
          <View style={styles.statRow}>
            <View style={styles.labelRow}>
              <Text style={styles.statLabel}>Hash rate</Text>
              <InfoButton term="hashRate" />
            </View>
            <Text style={styles.statValue}>{formatHashRate(oc?.hashRate ?? 0)}</Text>
          </View>
        </GlassCard>

        <GlassCard>
          <View style={styles.statRow}>
            <View style={styles.labelRow}>
              <Text style={styles.statLabel}>Difficulty</Text>
              <InfoButton term="difficulty" />
            </View>
            <Text style={styles.statValue}>
              {oc?.difficulty?.difficultyChange != null ? `${oc.difficulty.difficultyChange > 0 ? '+' : ''}${oc.difficulty.difficultyChange.toFixed(2)}%` : '--'}
            </Text>
          </View>
          {oc?.difficulty?.remainingBlocks != null && (
            <Text style={styles.statSub}>
              {oc.difficulty.remainingBlocks.toLocaleString('en-GB')} blocks until the next adjustment ({oc?.difficulty?.progressPercent?.toFixed?.(1) ?? 0}% of the way)
            </Text>
          )}
        </GlassCard>

        <GlassCard>
          <View style={styles.statRow}>
            <View style={styles.labelRow}>
              <Text style={styles.statLabel}>Mempool</Text>
              <InfoButton term="mempool" />
            </View>
            <View style={styles.congestionRow}>
              <Text style={styles.statValue}>{(oc?.mempool?.count ?? 0).toLocaleString('en-GB')} waiting</Text>
              <View style={[styles.congestionBadge, { backgroundColor: congestion.color + '33' }]}>
                <Text style={[styles.congestionText, { color: congestion.color }]}>{congestion.label}</Text>
              </View>
            </View>
          </View>
        </GlassCard>

        <GlassCard>
          <View style={[styles.labelRow, { marginBottom: Spacing.md }]}>
            <Text style={[styles.cardTitle, { marginBottom: 0 }]}>Fee estimates (sat/vB)</Text>
            <InfoButton term="fees" />
          </View>
          <View style={styles.feeRow}>
            {[
              { label: 'Fast', value: oc?.fees?.fastestFee, color: Colors.bearish },
              { label: 'Half an hour', value: oc?.fees?.halfHourFee, color: Colors.neutral },
              { label: 'An hour', value: oc?.fees?.hourFee, color: Colors.bullish },
            ].map((f, i) => (
              <View key={i} style={styles.feeCol}>
                <Text style={[styles.feeLabel, { color: f.color }]}>{f.label}</Text>
                <Text style={styles.feeValue}>{f?.value ?? '--'}</Text>
              </View>
            ))}
          </View>
        </GlassCard>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  headerTitle: { ...Typography.heading },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.md },
  sectionHeader: { ...Typography.subheading, marginTop: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  plainNote: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18, marginTop: -Spacing.xs },
  webNotice: { borderColor: Colors.accent + '55', borderWidth: 1 },
  webNoticeText: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18 },
  gaugeCard: { alignItems: 'center' },
  fgHistoryRow: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: Spacing.lg },
  fgHistoryCol: { alignItems: 'center' },
  fgHistLabel: { ...Typography.caption, color: Colors.textTertiary },
  fgHistValue: { ...Typography.subheading, ...Numbers, marginTop: 2 },
  fgHistClass: { ...Typography.caption, color: Colors.textSecondary, marginTop: 1 },
  cardTitle: { ...Typography.body, fontWeight: '600', marginBottom: Spacing.md },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { ...Typography.body, color: Colors.textSecondary },
  statValue: { ...Typography.monoData },
  statSub: { ...Typography.caption, color: Colors.textTertiary, marginTop: 4 },
  congestionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  congestionBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  congestionText: { ...Typography.caption, fontWeight: '700' },
  feeRow: { flexDirection: 'row', justifyContent: 'space-around' },
  feeCol: { alignItems: 'center' },
  feeLabel: { ...Typography.caption, fontWeight: '600' },
  feeValue: { ...Typography.monoData, marginTop: 4 },
});
