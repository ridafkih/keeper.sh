import { MS_PER_DAY } from "@keeper.sh/constants";
import { getStartOfToday } from "@keeper.sh/calendar";

const OAUTH_SYNC_LOOKBACK_DAYS = 7;
const OAUTH_SYNC_WINDOW_VERSION = 3;
const OAUTH_SYNC_LOOKBACK_MS = OAUTH_SYNC_LOOKBACK_DAYS * MS_PER_DAY;

interface OAuthSyncWindow {
  timeMin: Date;
  timeMax: Date;
}

const getOAuthSyncWindowStart = (startOfToday: Date = getStartOfToday()): Date =>
  new Date(startOfToday.getTime() - OAUTH_SYNC_LOOKBACK_MS);

const getOAuthSyncWindow = (
  yearsUntilFuture: number,
  startOfToday: Date = getStartOfToday(),
): OAuthSyncWindow => {
  const timeMin = getOAuthSyncWindowStart(startOfToday);
  const timeMax = new Date(startOfToday);
  timeMax.setFullYear(timeMax.getFullYear() + yearsUntilFuture);
  return { timeMax, timeMin };
};

export { OAUTH_SYNC_WINDOW_VERSION, getOAuthSyncWindowStart, getOAuthSyncWindow };
