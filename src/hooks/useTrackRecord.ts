import { useEffect, useMemo, useState } from 'react';
import { InteractionManager } from 'react-native';
import type { OHLCVCandle, SignalConfig } from '../types';
import { replayCalls, scoreCalls, REPLAY_WARMUP, type DayCall, type TrackRecord, type LoggedCall } from '../services/trackRecord';

/**
 * Days replayed per slice of work. Each day runs the full indicator set over a
 * 400-bar window; on a phone's JS engine that is a few milliseconds, so small
 * slices keep scrolling smooth while two years of history is replayed.
 */
const CHUNK = 8;

// Replays survive leaving and reopening the screen. Keyed by the data and the
// settings that affect the engine, so a new daily bar or a changed setting
// replays afresh.
const cache = new Map<string, DayCall[]>();

const keyFor = (daily: OHLCVCandle[], config: SignalConfig): string =>
  `${daily[0]?.time}:${daily[daily.length - 1]?.time}:${daily.length}:${config.stretchWeight}:${config.momentumWeight}`;

export interface TrackRecordState {
  /** Replay of the engine over past daily bars. Null while computing. */
  replay: TrackRecord | null;
  /** The calls this phone actually showed. */
  live: TrackRecord | null;
  /** 0..1 while replaying. */
  progress: number;
}

export const useTrackRecord = (
  closedDaily: OHLCVCandle[],
  config: SignalConfig,
  signalLog: LoggedCall[]
): TrackRecordState => {
  const key = keyFor(closedDaily, config);
  const [calls, setCalls] = useState<DayCall[] | null>(() => cache.get(key) ?? null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const cached = cache.get(key);
    if (cached) {
      setCalls(cached);
      return;
    }
    setCalls(null);
    setProgress(0);
    if (closedDaily.length < REPLAY_WARMUP + 7) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const out: DayCall[] = [];
    const start = REPLAY_WARMUP - 1;
    const total = closedDaily.length - start;
    let i = start;

    const step = () => {
      if (cancelled) return;
      out.push(...replayCalls(closedDaily, i, i + CHUNK, config));
      i += CHUNK;
      if (i < closedDaily.length) {
        setProgress((i - start) / total);
        timer = setTimeout(step, 0);
      } else {
        cache.set(key, out);
        setCalls(out);
        setProgress(1);
      }
    };
    // Let the tab transition finish before starting.
    const task = InteractionManager.runAfterInteractions(step);
    return () => {
      cancelled = true;
      task.cancel();
      if (timer) clearTimeout(timer);
    };
    // `key` already covers closedDaily and config.
  }, [key]);

  const replay = useMemo(() => (calls ? scoreCalls(calls, closedDaily) : null), [calls, closedDaily]);
  const live = useMemo(() => (signalLog.length ? scoreCalls(signalLog, closedDaily) : null), [signalLog, closedDaily]);

  return { replay, live, progress };
};
