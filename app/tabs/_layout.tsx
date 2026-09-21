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
        tabBarInactiveTintColor: '#666666',
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
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
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
        name="onchain"
        options={{
          title: 'On-Chain',
          tabBarIcon: ({ color, size }) => <Ionicons name="link" size={size} color={color} />,
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
