import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { Slot } from 'expo-router';
import { PaperProvider, MD3DarkTheme } from 'react-native-paper';
import { SettingsProvider } from '../src/context/SettingsContext';
import { DataProvider } from '../src/context/DataContext';
import { JournalProvider } from '../src/context/JournalContext';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

const paperTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#00D2FF',
    background: '#0A0A0F',
    surface: '#12121A',
    onSurface: '#E8E8F0',
    onBackground: '#E8E8F0',
  },
};

export default function RootLayout() {
  useEffect(() => {
    const timer = setTimeout(() => {
      SplashScreen.hideAsync();
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <PaperProvider theme={paperTheme}>
      <SettingsProvider>
        <DataProvider>
          <JournalProvider>
            <StatusBar barStyle="light-content" backgroundColor="#0A0A0F" />
            <Slot />
          </JournalProvider>
        </DataProvider>
      </SettingsProvider>
    </PaperProvider>
  );
}
