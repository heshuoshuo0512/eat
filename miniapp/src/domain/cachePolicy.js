export const DEFAULT_DATA_MAX_AGE_MS = 15_000;

export function isDataCacheStale(lastLoadedAt, now = Date.now(), maxAgeMs = DEFAULT_DATA_MAX_AGE_MS) {
  const loadedAt = Number(lastLoadedAt);
  const currentTime = Number(now);
  const maxAge = Math.max(0, Number(maxAgeMs) || DEFAULT_DATA_MAX_AGE_MS);
  if (!Number.isFinite(loadedAt) || loadedAt <= 0 || !Number.isFinite(currentTime)) return true;
  return currentTime - loadedAt >= maxAge;
}
