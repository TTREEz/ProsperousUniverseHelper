import { idbGet, idbSet } from "@/storage/idb";

/**
 * Persistent cache for FIO reference data.
 *
 * Materials, buildings and recipes change only when the game updates, so
 * re-fetching them on every load is wasted time and makes the app useless
 * without a connection. Cached responses live in IndexedDB, deliberately
 * outside the user's save file — this is replaceable game data, not their work.
 *
 * A failed fetch falls back to stale cache rather than erroring, so the app
 * keeps working offline once it has been used online at least once.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

type CacheEntry<T> = { value: T; fetchedAt: number };

export type CacheStatus = "fresh" | "revalidated" | "stale-offline" | "miss";

let lastStatus: CacheStatus = "miss";

export function lastCacheStatus(): CacheStatus {
  return lastStatus;
}

export async function cachedFetch<T>(key: string, fetcher: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const cacheKey = `fio:${key}`;
  const cached = await idbGet<CacheEntry<T>>(cacheKey);
  const isFresh = cached !== null && Date.now() - cached.fetchedAt < ttlMs;

  if (isFresh) {
    lastStatus = "fresh";
    return cached.value;
  }

  try {
    const value = await fetcher();
    await idbSet(cacheKey, { value, fetchedAt: Date.now() } satisfies CacheEntry<T>);
    lastStatus = cached ? "revalidated" : "miss";
    return value;
  } catch (error) {
    if (cached) {
      lastStatus = "stale-offline";
      return cached.value;
    }
    throw error;
  }
}
