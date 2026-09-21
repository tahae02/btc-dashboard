import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, BorderRadius } from '../constants/theme';

interface Props {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export const SkeletonLoader = ({ width, height, borderRadius = BorderRadius.md, style }: Props) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width: width as any, height, borderRadius, opacity },
        style,
      ]}
    />
  );
};

const styles = StyleSheet.create({
  skeleton: { backgroundColor: Colors.shimmerHighlight },
});
