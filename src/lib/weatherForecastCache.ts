const STORAGE_KEY = "weatherApp.forecast.v1";

/** How long a cached forecast is treated as fresh (skip network on reopen). */
export const FORECAST_CACHE_TTL_MS = 30 * 60 * 1000;

export type ForecastCacheRecord<T> = {
  v: 1;
  savedAt: number;
  query: string;
  response: T;
};

function safeParse(raw: string | null): ForecastCacheRecord<unknown> | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as ForecastCacheRecord<unknown>;
    if (o?.v !== 1 || typeof o.savedAt !== "number" || typeof o.query !== "string" || !o.response) {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function readForecastCache<T>(): ForecastCacheRecord<T> | null {
  if (typeof localStorage === "undefined") return null;
  return safeParse(localStorage.getItem(STORAGE_KEY)) as ForecastCacheRecord<T> | null;
}

export function writeForecastCache<T>(query: string, response: T): void {
  if (typeof localStorage === "undefined") return;
  const rec: ForecastCacheRecord<T> = {
    v: 1,
    savedAt: Date.now(),
    query,
    response,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  } catch {
    /* quota / private mode */
  }
}

export function isForecastCacheFresh(
  entry: ForecastCacheRecord<unknown>,
  ttlMs: number = FORECAST_CACHE_TTL_MS
): boolean {
  return Date.now() - entry.savedAt < ttlMs;
}
