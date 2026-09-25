import React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useExplain } from '../context/ExplainContext';
import { GLOSSARY, type GlossaryKey } from '../services/glossary';
import { Colors } from '../constants/theme';

interface Props {
  term: GlossaryKey | string;
  size?: number;
}

/** A small (i) next to a label. Tapping it explains the term in plain English. */
export const InfoButton = ({ term, size = 16 }: Props) => {
  const { explain } = useExplain();
  const title = (GLOSSARY as Record<string, { title: string }>)[term]?.title ?? 'this';
  return (
    <Pressable
      onPress={() => explain(term)}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={`What is ${title}?`}
    >
      <Ionicons name="information-circle-outline" size={size} color={Colors.textTertiary} />
    </Pressable>
  );
};
