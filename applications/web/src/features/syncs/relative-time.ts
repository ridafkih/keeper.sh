const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const formatSyncedAgo = (value: string | null, nowMs = Date.now()): string => {
  if (!value) return "Not synced yet";
  const elapsed = Math.max(0, nowMs - new Date(value).getTime());
  if (elapsed < MINUTE_MS) return "Just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
};
