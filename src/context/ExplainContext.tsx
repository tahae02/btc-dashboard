import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GLOSSARY, GLOSSARY_SECTIONS, type GlossaryKey, type GlossaryEntry } from '../services/glossary';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';

interface ExplainContextValue {
  /** Show the plain-English explanation of one term. */
  explain: (term: GlossaryKey | string) => void;
  /** Show every term, grouped. */
  openGuide: () => void;
}

const ExplainContext = createContext<ExplainContextValue>({ explain: () => {}, openGuide: () => {} });

export const useExplain = () => useContext(ExplainContext);

const isKey = (k: string): k is GlossaryKey => k in GLOSSARY;

const EntryBody = ({ entry }: { entry: GlossaryEntry }) => (
  <>
    <Text style={styles.what}>{entry.what}</Text>
    <Text style={styles.subhead}>What it tends to mean</Text>
    <Text style={styles.read}>{entry.read}</Text>
    {entry.app ? (
      <>
        <Text style={styles.subhead}>In this app</Text>
        <Text style={styles.read}>{entry.app}</Text>
      </>
    ) : null}
  </>
);

/**
 * One shared sheet for every explanation, rather than a Modal per "?" button:
 * there are dozens of buttons and only ever one explanation open.
 */
export const ExplainProvider = ({ children }: { children: ReactNode }) => {
  const [term, setTerm] = useState<GlossaryKey | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [expanded, setExpanded] = useState<GlossaryKey | null>(null);

  const explain = useCallback((k: string) => {
    if (isKey(k)) setTerm(k);
  }, []);
  const openGuide = useCallback(() => {
    setExpanded(null);
    setGuideOpen(true);
  }, []);
  const value = useMemo(() => ({ explain, openGuide }), [explain, openGuide]);

  const entry = term ? GLOSSARY[term] : null;

  return (
    <ExplainContext.Provider value={value}>
      {children}

      <Modal visible={entry != null} animationType="fade" transparent onRequestClose={() => setTerm(null)}>
        <Pressable style={styles.backdrop} onPress={() => setTerm(null)} accessibilityLabel="Close">
          <Pressable style={styles.card} onPress={() => {}}>
            {entry && (
              <ScrollView>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{entry.title}</Text>
                  <Pressable onPress={() => setTerm(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                    <Ionicons name="close" size={22} color={Colors.textSecondary} />
                  </Pressable>
                </View>
                <EntryBody entry={entry} />
                <Pressable
                  onPress={() => { setTerm(null); openGuide(); }}
                  style={styles.guideLink}
                  accessibilityRole="button"
                >
                  <Text style={styles.link}>See all terms explained</Text>
                </Pressable>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={guideOpen} animationType="slide" transparent onRequestClose={() => setGuideOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={[styles.titleRow, styles.sheetHeader]}>
              <Text style={styles.title}>Jargon explained</Text>
              <Pressable onPress={() => setGuideOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetContent}>
              <Text style={styles.intro}>
                Every term the app uses, in plain English. Tap one to see what it tends to mean. You can also tap the{' '}
                <Ionicons name="information-circle-outline" size={13} color={Colors.textSecondary} /> next to anything in the app.
              </Text>
              {GLOSSARY_SECTIONS.map((section) => (
                <View key={section.title} style={styles.section}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {section.keys.map((k) => {
                    const e = GLOSSARY[k];
                    const open = expanded === k;
                    return (
                      <Pressable
                        key={k}
                        onPress={() => setExpanded(open ? null : k)}
                        style={styles.row}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                      >
                        <View style={styles.rowHead}>
                          <Text style={styles.rowTitle}>{e.title}</Text>
                          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textTertiary} />
                        </View>
                        {open ? <EntryBody entry={e} /> : <Text style={styles.rowWhat} numberOfLines={2}>{e.what}</Text>}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ExplainContext.Provider>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: Spacing.lg },
  card: {
    maxHeight: '80%', backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.cardBorder, padding: Spacing.lg,
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md, marginBottom: Spacing.sm },
  title: { ...Typography.subheading, flex: 1 },
  what: { ...Typography.body, color: Colors.textPrimary, lineHeight: 23, fontSize: 15 },
  subhead: { ...Typography.caption, color: Colors.accent, fontWeight: '700', marginTop: Spacing.md, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  read: { ...Typography.body, color: Colors.textSecondary, lineHeight: 22, fontSize: 15 },
  guideLink: { marginTop: Spacing.lg, paddingVertical: 4 },
  link: { ...Typography.body, color: Colors.accent, fontWeight: '600', fontSize: 15 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    height: '92%', backgroundColor: Colors.background, borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  sheetHeader: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, marginBottom: 0 },
  sheetContent: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  intro: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18 },
  section: { marginTop: Spacing.lg, gap: Spacing.sm },
  sectionTitle: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { backgroundColor: Colors.card, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.cardBorder, padding: Spacing.md },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: 4 },
  rowTitle: { ...Typography.body, fontWeight: '600', flex: 1 },
  rowWhat: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 17 },
});
