import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Settings, RefreshInterval, Currency, Timeframe } from '../types';
import { sanitiseSettings, DEFAULT_SETTINGS as defaultSettings } from '../services/settings';

// Bumped from the v1 key: the settings shape changed (volumeSpikeMultiplier
// went away, signalTimeframe and stretchWeight arrived), and sanitiseSettings
// would silently reset a v1 payload anyway.
const STORAGE_KEY = 'btc_dashboard_settings_v2';

interface SettingsContextValue extends Settings {
  setRefreshInterval: (v: RefreshInterval) => void;
  setCurrency: (v: Currency) => void;
  setSignalTimeframe: (v: Timeframe) => void;
  setRsiOverbought: (v: number) => void;
  setRsiOversold: (v: number) => void;
  setStretchWeight: (v: number) => void;
  resetDefaults: () => void;
  isLoaded: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
  ...defaultSettings,
  setRefreshInterval: () => {},
  setCurrency: () => {},
  setSignalTimeframe: () => {},
  setRsiOverbought: () => {},
  setRsiOversold: () => {},
  setStretchWeight: () => {},
  resetDefaults: () => {},
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
        // Stored values are sanitised too: an old or hand-edited payload must
        // not be able to put the app into an invalid state.
        if (stored) setSettings(sanitiseSettings(JSON.parse(stored) ?? {}));
      } catch { /* fall back to defaults */ }
      setIsLoaded(true);
    })();
  }, []);

  const update = useCallback((partial: Partial<Settings>) => {
    setSettings((prev) => {
      const next = sanitiseSettings({ ...prev, ...partial });
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value: SettingsContextValue = {
    ...settings,
    setRefreshInterval: (v) => update({ refreshInterval: v }),
    setCurrency: (v) => update({ currency: v }),
    setSignalTimeframe: (v) => update({ signalTimeframe: v }),
    setRsiOverbought: (v) => update({ rsiOverbought: v }),
    setRsiOversold: (v) => update({ rsiOversold: v }),
    setStretchWeight: (v) => update({ stretchWeight: v }),
    resetDefaults: () => update(defaultSettings),
    isLoaded,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};
