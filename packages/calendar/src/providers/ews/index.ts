import type { EwsCalendar } from "./client";
import type { DiscoveredCalendar } from "../../core/source/calendar-rediscovery";
export const toDiscoveredEwsCalendars = (
  folders: EwsCalendar[],
): DiscoveredCalendar[] =>
  folders
    .filter((folder) => folder.canRead)
    .map((folder) => ({
      identityKey: folder.id,
      externalCalendarId: folder.id,
      name: folder.name,
      writable: folder.canWrite,
      calendarUrl: null,
    }));
export { EwsClient, EwsError } from "./client";
export type { EwsCalendar } from "./client";
export { parseEwsConfig, ewsConnectionIdentity } from "./config";
export type { EwsConfig, EwsAuth, EwsRuntimeOptions } from "./config";
export { createEwsSourceFetcher, createEwsSyncProvider } from "./provider";
export type { EwsProviderConfig } from "./provider";
export {
  beginEwsDeviceAuthorization,
  pollEwsDeviceAuthorization,
  getEwsUserAccessToken,
} from "./oauth";
export { createEwsTokenProvider } from "./token-store";
