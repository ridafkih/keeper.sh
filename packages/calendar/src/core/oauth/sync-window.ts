import { MS_PER_DAY } from "@keeper.sh/constants";

const OAUTH_SYNC_WINDOW_VERSION = 4;
const OAUTH_SYNC_TOKEN_REFRESH_MS = 7 * MS_PER_DAY;

const getDeterministicRefreshOffset = (calendarKey: string): number => {
  if (calendarKey.length === 0) {
    return 0;
  }
  const digest = new Bun.CryptoHasher("sha256").update(calendarKey).digest("hex");
  const hashPrefix = Number.parseInt(digest.slice(0, 12), 16);
  return hashPrefix % OAUTH_SYNC_TOKEN_REFRESH_MS;
};

const getOAuthSyncTokenVersion = (
  adapterVersion = 0,
  now: Date = new Date(),
  calendarKey = "",
): number => {
  const refreshOffset = getDeterministicRefreshOffset(calendarKey);
  const refreshPeriod = Math.floor(
    (now.getTime() - refreshOffset) / OAUTH_SYNC_TOKEN_REFRESH_MS,
  );
  return refreshPeriod * 100 + OAUTH_SYNC_WINDOW_VERSION * 10 + adapterVersion;
};

export {
  OAUTH_SYNC_TOKEN_REFRESH_MS,
  OAUTH_SYNC_WINDOW_VERSION,
  getDeterministicRefreshOffset,
  getOAuthSyncTokenVersion,
};
