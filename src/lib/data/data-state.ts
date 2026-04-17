import { DatabaseUnavailableError } from "@/lib/db/errors";
import { getSyncSourceConfig, type SyncSource } from "@/lib/sync/config";
import type { LatestTerminalSyncRun } from "@/lib/data/mode";

export type DataStateKind = "ok" | "empty" | "stale" | "unavailable";

export interface ResolveDataStateInput {
  source: SyncSource;
  hasData: boolean;
  latestSyncRun: LatestTerminalSyncRun | null;
  error?: unknown;
  now?: Date;
}

export interface ResolvedDataState {
  kind: DataStateKind;
  source: SyncSource;
  lastSyncedAt: Date | null;
  staleAfter: Date | null;
}

/**
 * Pure resolver that maps (source, data presence, latest sync metadata,
 * typed loader error) into one of `ok | empty | stale | unavailable`.
 *
 *  - `unavailable` whenever the loader threw `DatabaseUnavailableError`
 *  - `empty` when there is no data and no prior terminal sync
 *  - `stale` when data exists but the last sync is older than
 *    `normalIntervalMs * 2` for the source
 *  - `ok` otherwise
 *
 * Stale with no data still surfaces as `empty` — the user needs an
 * onboarding CTA, not a "last synced" banner pointing at nothing.
 */
export function resolveDataState(
  input: ResolveDataStateInput
): ResolvedDataState {
  const { source, hasData, latestSyncRun, error, now = new Date() } = input;
  const lastSyncedAt = latestSyncRun?.completedAt ?? null;

  if (error instanceof DatabaseUnavailableError) {
    return { kind: "unavailable", source, lastSyncedAt, staleAfter: null };
  }

  if (!hasData) {
    return { kind: "empty", source, lastSyncedAt, staleAfter: null };
  }

  if (lastSyncedAt) {
    const staleAfterMs = getSyncSourceConfig(source).normalIntervalMs * 2;
    const staleAfter = new Date(lastSyncedAt.getTime() + staleAfterMs);
    if (now.getTime() > staleAfter.getTime()) {
      return { kind: "stale", source, lastSyncedAt, staleAfter };
    }
  }

  return { kind: "ok", source, lastSyncedAt, staleAfter: null };
}

export interface SafeLoadResult<T> {
  data: T;
  error: DatabaseUnavailableError | null;
}

/**
 * Wrap a DB-backed loader so `DatabaseUnavailableError` becomes a result
 * (with the provided fallback) instead of a throw. Other errors still
 * propagate — schema compatibility errors bubble to the existing error
 * boundary, where a retry/redeploy copy is appropriate. This lets pages
 * use `Promise.all` without one transient outage crashing unrelated
 * sections.
 */
export async function safeLoad<T>(
  fn: () => Promise<T>,
  fallback: T
): Promise<SafeLoadResult<T>> {
  try {
    return { data: await fn(), error: null };
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      return { data: fallback, error };
    }
    throw error;
  }
}
