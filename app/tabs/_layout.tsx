import React from 'react';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../src/constants/theme';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarStyle: {
          backgroundColor: 'rgba(18,18,26,0.95)',
          borderTopColor: Colors.cardBorder,
          borderTopWidth: 1,
          paddingBottom: insets.bottom,
          height: 60 + insets.bottom,
          ...Platform.select({
            web: { backdropFilter: 'blur(20px)' } as any,
            default: {},
          }),
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          // 'Dashboard' is cut to 'Dashbo...' once there are six tabs.
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          tabBarButtonTestID: 'tab-dashboard',
        }}
      />
      <Tabs.Screen
        name="chart"
        options={{
          title: 'Chart',
          tabBarIcon: ({ color, size }) => <Ionicons name="analytics" size={size} color={color} />,
          tabBarButtonTestID: 'tab-chart',
        }}
      />
      <Tabs.Screen
        name="signals"
        options={{
          title: 'Signals',
          tabBarIcon: ({ color, size }) => <Ionicons name="pulse" size={size} color={color} />,
          tabBarButtonTestID: 'tab-signals',
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: 'Portfolio',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" size={size} color={color} />,
          tabBarButtonTestID: 'tab-portfolio',
        }}
      />
      <Tabs.Screen
        name="onchain"
        options={{
          // Mood (Fear & Greed), market size and network health. It was called
          // On-Chain, but Fear & Greed is mood, not on-chain data.
          title: 'Market',
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
          tabBarButtonTestID: 'tab-onchain',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
          tabBarButtonTestID: 'tab-settings',
        }}
      />
    </Tabs>
  );
}
