import React, { createContext, useContext, type ReactNode } from 'react';
import { MarketData, Timeframe } from '../types';
import { useMarketData } from '../hooks/useMarketData';
import { useSettings } from './SettingsContext';

interface DataContextValue extends MarketData {
  loadTimeframe: (tf: Timeframe) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export const useData = (): DataContextValue => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be inside DataProvider');
  return ctx;
};

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const { refreshInterval, currency } = useSettings();
  const data = useMarketData(refreshInterval, currency);
  return <DataContext.Provider value={data as DataContextValue}>{children}</DataContext.Provider>;
};
