/**
 * The app's data fetchers.
 *
 * The fetching and parsing live in ./marketApi, which has no React Native
 * imports so the headless snapshot (`yarn snapshot`) and the tests run the
 * same code. This module adds the one rule that depends on the platform.
 */
import { Platform } from 'react-native';
import type { OnChainData } from '../types';
import { fetchOnChainData as fetchOnChainDataAnywhere } from './marketApi';

export { fetchPriceData, fetchOHLCV, fetchBTCDominance, fetchFearGreed, fetchFearGreedHistory } from './marketApi';

export const IS_WEB = Platform.OS === 'web';

// mempool.space does not send CORS headers, so browser fetches always fail.
// Skip them on web (the On-Chain screen shows a "mobile app" notice) and run
// them only in the native build where CORS restrictions do not apply.
export const fetchOnChainData = async (): Promise<OnChainData> =>
  IS_WEB ? { hashRate: 0, difficulty: null, mempool: null, fees: null } : fetchOnChainDataAnywhere();
