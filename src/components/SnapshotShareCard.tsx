import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Share, Platform, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from './GlassCard';
import { useSettings } from '../context/SettingsContext';
import { fetchPriceData, fetchOHLCV, fetchBTCDominance, fetchFearGreed, fetchOnChainData } from '../services/api';
import { buildReport, collectSnapshot, summariseSources, formatUkTime, type SnapshotFetchers } from '../services/marketReport';
import { sanitiseSettings } from '../services/settings';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';

const FETCHERS: SnapshotFetchers = {
  fetchPriceData,
  fetchOHLCV: (tf) => fetchOHLCV(tf),
  fetchBTCDominance,
  fetchFearGreed,
  fetchOnChainData,
};

/**
 * Builds the same plain-text report as `yarn snapshot`, from this phone's own
 * connection and settings, and hands it to the share sheet. It is what Claude
 * reads for /btc-brief when its own sandbox cannot reach the data sources.
 *
 * Text rather than screenshots or a zip: every number on the screens is in
 * it, exactly, and pasted text is what a Claude chat takes most reliably.
 */
export const SnapshotShareCard = () => {
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Browsers without a share sheet get the text on screen to copy instead.
  const [fallbackText, setFallbackText] = useState<string | null>(null);

  const share = async () => {
    setBusy(true);
    setStatus(null);
    setFallbackText(null);
    try {
      const { input } = await collectSnapshot(FETCHERS, sanitiseSettings(settings), { origin: 'app' });
      const text = buildReport(input);
      setStatus(`Taken ${formatUkTime(input.now)}. ${summariseSources(input.sources)}`);
      try {
        await Share.share({ message: text, title: 'BTC Analyst snapshot' });
      } catch {
        // Android and iOS only throw here if the share sheet cannot open at
        // all; on the web it means the browser has no share sheet.
        setFallbackText(text);
      }
    } catch (e) {
      setStatus(`Could not build the snapshot (${e instanceof Error ? e.message : 'unknown error'}).`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard>
      <Text style={styles.label}>Snapshot for Claude</Text>
      <Text style={styles.sub}>
        Fetches fresh data and puts every number the app works from into one piece of text: the price in pounds and
        dollars, Fear &amp; Greed, every indicator, each part of the signal and the app&apos;s advice, as they stand
        right now.
      </Text>
      <Text style={styles.sub}>
        Tap below and choose Copy (or the Claude app). Then in Claude send /btc-brief followed by the amount you are
        thinking of buying, and paste the snapshot underneath. Nothing leaves your phone until you pick where to send
        it.
      </Text>

      <Pressable
        style={[styles.button, busy && styles.buttonBusy]}
        onPress={share}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Share snapshot for Claude"
      >
        {busy ? (
          <ActivityIndicator size="small" color={Colors.accent} />
        ) : (
          <Ionicons name="share-outline" size={18} color={Colors.accent} />
        )}
        <Text style={styles.buttonText}>{busy ? 'Fetching fresh data...' : 'Share snapshot'}</Text>
      </Pressable>

      {status && <Text style={styles.status}>{status}</Text>}

      {fallbackText && (
        <View style={{ marginTop: Spacing.md }}>
          <Text style={styles.sub}>
            {Platform.OS === 'web' ? 'This browser has no share sheet.' : 'The share sheet did not open.'} Select all
            of the text below and copy it instead.
          </Text>
          <TextInput
            style={styles.fallback}
            value={fallbackText}
            multiline
            editable={false}
            selectTextOnFocus
            accessibilityLabel="Snapshot text"
          />
        </View>
      )}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  label: { ...Typography.body, fontWeight: '600', marginBottom: Spacing.sm },
  sub: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 17, marginBottom: Spacing.sm },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    marginTop: Spacing.sm, paddingVertical: 12, borderRadius: BorderRadius.sm,
    borderWidth: 1, borderColor: Colors.accent, backgroundColor: Colors.elevated,
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { ...Typography.body, color: Colors.accent, fontWeight: '600' },
  status: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 17, marginTop: Spacing.md },
  fallback: {
    ...Typography.caption, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    color: Colors.textPrimary, backgroundColor: Colors.elevated, borderRadius: BorderRadius.sm,
    borderWidth: 1, borderColor: Colors.cardBorder, padding: Spacing.sm, height: 240, marginTop: Spacing.sm,
  },
});
