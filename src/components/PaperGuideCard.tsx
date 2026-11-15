import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from './GlassCard';
import { InfoButton } from './InfoButton';
import { Colors, Typography, Spacing } from '../constants/theme';

/**
 * When and how often to paper trade, so the record ends up fair. The
 * routine is what keeps it fair: a record kept only on exciting days would
 * say more about which days felt exciting than about the advice.
 */
const SECTIONS: { title: string; points: string[] }[] = [
  {
    title: 'When to make a paper decision',
    points: [
      'Every regular buy day. Pick one day a week, or your payday, and make a paper decision every time, whatever the market is doing. Mark it "Regular buy day". This is the backbone of the record, and the only part not skewed towards exciting days.',
      'As an extra when something happens: the advice changes, Bitcoin moves 5% in a day or 10% in a week, Fear & Greed is 20 or below or 80 or above, or a big event is due (a US Fed rate decision, US inflation figures). The app points these out under "Why now?". At most one extra a day.',
      'Whenever you are about to trade for real, or are tempted to. Log what the advice says here first ("Tempted to trade for real"), then do whatever you like with real money. Comparing the two shows whether your own judgement adds anything.',
    ],
  },
  {
    title: 'How to do it',
    points: [
      "Follow the advice to the letter. The app's amount is filled in for you: leave it. With /btc-brief, choose \"Claude's brief\", enter its verdict and chances, and place its limit orders here at its prices and expiry.",
      'When the advice says buy little or nothing, record "Don\'t buy". Holding back is a decision too, and the record cannot judge it otherwise.',
      'Disagree now and then, on purpose, as "My own call". A few of those give the advice something to be measured against.',
      'Never delete a paper trade because it went badly, and keep your usual amount the same for months at a time. Paper trades are always at the live price, so they cannot be back-dated with hindsight.',
      'Set the fees in Paper settings to what your real orders cost: on Coinbase, the fee divided by the total on a recent order.',
    ],
  },
  {
    title: 'How long before it means anything',
    points: [
      'A week for the first 7-day results, a month for the first 30-day ones.',
      "About 20 of Claude's calls before its chances can be judged: two or three months at two a week.",
      "Six to twelve months of weekly decisions before the app's advice tiers can be, and longer for the rarer ones.",
      'Glance at the scorecard once a month. Every three months, export the CSV below and paste it to Claude with /paper-review.',
    ],
  },
];

/** The guide in three pictures; the full text above is one tap away. */
const STEPS: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
  { icon: 'calendar-outline', title: 'When', text: 'Every regular buy day, without fail. Extras when something big happens.' },
  { icon: 'checkmark-done-outline', title: 'How', text: "Follow the advice. The app's amount is filled in: leave it." },
  { icon: 'hourglass-outline', title: 'How long', text: 'A month for first results. 6 to 12 months to judge.' },
];

export const PaperGuideCard = ({ initiallyOpen }: { initiallyOpen: boolean }) => {
  const [open, setOpen] = useState(false);
  return (
    <GlassCard>
      <View style={styles.titleRow}>
        <Text style={styles.title}>How to paper trade</Text>
        <InfoButton term="paperTrading" />
      </View>
      {(initiallyOpen || open) && (
        <View style={styles.steps}>
          {STEPS.map((step, i) => (
            <View key={step.title} style={styles.step}>
              <View style={styles.stepIcon}>
                <Ionicons name={step.icon} size={22} color={Colors.paper} />
                <Text style={styles.stepNum}>{i + 1}</Text>
              </View>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepText}>{step.text}</Text>
            </View>
          ))}
        </View>
      )}
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.head} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={styles.more}>{open ? 'Hide the full guide' : initiallyOpen ? 'Read the full guide' : 'When, how, and how long: show the guide'}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.paper} />
      </Pressable>
      {open &&
        SECTIONS.map((s) => (
          <View key={s.title} style={styles.section}>
            <Text style={styles.subtitle}>{s.title}</Text>
            {s.points.map((p) => (
              <View key={p} style={styles.point}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.text}>{p}</Text>
              </View>
            ))}
          </View>
        ))}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm, paddingVertical: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...Typography.subheading },
  more: { ...Typography.caption, fontSize: 14, color: Colors.paper, fontWeight: '600', flex: 1 },
  steps: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  step: { flex: 1, backgroundColor: Colors.paper + '14', borderRadius: 12, padding: Spacing.sm, gap: 4 },
  stepIcon: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepNum: { ...Typography.caption, color: Colors.paper, fontWeight: '700' },
  stepTitle: { ...Typography.body, fontSize: 15, fontWeight: '700' },
  stepText: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 17 },
  section: { marginTop: Spacing.md },
  subtitle: { ...Typography.body, fontWeight: '600', color: Colors.paper, marginBottom: Spacing.xs },
  point: { flexDirection: 'row', gap: 8, marginTop: 6 },
  bullet: { ...Typography.caption, color: Colors.textTertiary, lineHeight: 18 },
  text: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18, flex: 1 },
});
