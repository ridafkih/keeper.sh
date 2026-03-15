import { getOAuthSyncWindow } from "../../core";

interface CalDAVSyncWindow {
  start: Date;
  end: Date;
}

const getCalDAVSyncWindow = (
  yearsUntilFuture: number,
  startOfToday?: Date,
): CalDAVSyncWindow => {
  const oauthSyncWindow = getOAuthSyncWindow(yearsUntilFuture, startOfToday);
  return {
    end: oauthSyncWindow.timeMax,
    start: oauthSyncWindow.timeMin,
  };
};

export { getCalDAVSyncWindow };
export type { CalDAVSyncWindow };
