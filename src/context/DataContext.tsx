import React, { createContext, useContext, type ReactNode } from 'react';
import type { MarketData } from '../types';
import { useMarketData } from '../hooks/useMarketData';
import { useSettings } from './SettingsContext';

type DataContextValue = MarketData;

const DataContext = createContext<DataContextValue | null>(null);

export const useData = (): DataContextValue => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be inside DataProvider');
  return ctx;
};

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const { refreshInterval, signalTimeframe } = useSettings();
  const data = useMarketData(refreshInterval, signalTimeframe);
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
};
