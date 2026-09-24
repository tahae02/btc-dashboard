import React, { type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing } from '../constants/theme';

interface Props {
  children: ReactNode;
  /** Shown instead of the children if they throw while rendering. */
  fallbackTitle?: string;
  /** Changing this clears a caught error, e.g. when the user switches view. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

/**
 * Contains a render error to one section of a screen.
 *
 * Wrapped around third-party components whose behaviour on odd data cannot be
 * verified ahead of time, so a failure costs that section, not the whole app.
 *
 * Its limit, stated plainly: this catches JavaScript errors thrown while
 * rendering. It cannot catch a native crash, such as Android refusing to draw
 * an oversized bitmap, because that happens outside JavaScript entirely. Those
 * have to be prevented at the source, not caught.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.box}>
        <Text style={styles.title}>{this.props.fallbackTitle ?? 'This section could not be drawn'}</Text>
        <Text style={styles.detail} numberOfLines={3}>
          {this.state.error.message}
        </Text>
        <Pressable onPress={() => this.setState({ error: null })} accessibilityRole="button">
          <Text style={styles.retry}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  box: { minHeight: 160, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.sm },
  title: { ...Typography.body, fontWeight: '600', textAlign: 'center' },
  detail: { ...Typography.caption, color: Colors.textTertiary, textAlign: 'center' },
  retry: { ...Typography.body, color: Colors.accent, marginTop: Spacing.sm },
});
