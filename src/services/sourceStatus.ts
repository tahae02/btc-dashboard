/**
 * Turns the outcome of a refresh into the message the Dashboard shows.
 *
 * Each failing source is named WITH its reason. "Fear & Greed is unavailable"
 * alone cannot distinguish a provider blocking the phone (HTTP 403), an
 * outage (HTTP 5xx), a slow network (timed out) or a DNS or TLS problem
 * (could not connect), and those need completely different responses.
 */

export interface SourceFailure {
  label: string;
  reason: string;
}

export type ErrorKind = 'offline' | 'partial';

export interface RefreshStatus {
  error: string | null;
  errorKind: ErrorKind | null;
}

const joinList = (items: string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * @param failures  every source that failed and is worth reporting
 * @param coreFailed whether BOTH live price and price history failed, i.e.
 *                   there is nothing current to show at all
 */
export const summariseRefresh = (failures: SourceFailure[], coreFailed: boolean): RefreshStatus => {
  if (coreFailed) {
    const reason = failures[0]?.reason;
    return {
      errorKind: 'offline',
      error: `Unable to fetch market data${reason ? ` (${reason})` : ''}. Check your connection.`,
    };
  }
  if (failures.length === 0) return { error: null, errorKind: null };
  const list = joinList(failures.map((f) => `${f.label} (${f.reason})`));
  return {
    errorKind: 'partial',
    error: `${list} ${failures.length === 1 ? 'is' : 'are'} unavailable. Everything else is live.`,
  };
};
