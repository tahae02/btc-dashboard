import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Settings, RefreshInterval, Currency } from '../types';

const STORAGE_KEY = 'btc_dashboard_settings';

const defaultSettings: Settings = {
  refreshInterval: '5min',
  currency: 'USD',
  rsiOverbought: 70,
  rsiOversold: 30,
  volumeSpikeMultiplier: 1.5,
};

interface SettingsContextValue extends Settings {
  setRefreshInterval: (v: RefreshInterval) => void;
  setCurrency: (v: Currency) => void;
  setRsiOverbought: (v: number) => void;
  setRsiOversold: (v: number) => void;
  setVolumeSpikeMultiplier: (v: number) => void;
  isLoaded: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
  ...defaultSettings,
  setRefreshInterval: () => {},
  setCurrency: () => {},
  setRsiOverbought: () => {},
  setRsiOversold: () => {},
  setVolumeSpikeMultiplier: () => {},
  isLoaded: false,
});

export const useSettings = () => useContext(SettingsContext);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setSettings((prev) => ({ ...prev, ...(parsed ?? {}) }));
        }
      } catch { /* use defaults */ }
      setIsLoaded(true);
    })();
  }, []);

  const persist = useCallback(async (next: Settings) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  }, []);

  const update = useCallback((partial: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      persist(next);
      return next;
    });
  }, [persist]);

  const value: SettingsContextValue = {
    ...settings,
    setRefreshInterval: (v) => update({ refreshInterval: v }),
    setCurrency: (v) => update({ currency: v }),
    setRsiOverbought: (v) => update({ rsiOverbought: v }),
    setRsiOversold: (v) => update({ rsiOversold: v }),
    setVolumeSpikeMultiplier: (v) => update({ volumeSpikeMultiplier: v }),
    isLoaded,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};
