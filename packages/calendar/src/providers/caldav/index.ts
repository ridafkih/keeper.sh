export { createCalDAVSourceFetcher, type CalDAVSourceFetcherConfig } from "./source/fetch-adapter";
export { isCalDAVAuthenticationError } from "./source/auth-error-classification";
export { createCalDAVSyncProvider, type CalDAVSyncProviderConfig } from "./destination/provider";

export { createCalDAVSourceProvider } from "./source/provider";
export { createCalDAVSourceService } from "./source/sync";

export {
  CalDAVAuthenticationError,
  CalDAVClient,
  CalDAVIncompleteMultiGetError,
  CalDAVWithheldCredentialsError,
  createCalDAVClient,
} from "./shared/client";
export {
  findCalendarByStoredUrl,
  normalizeCalDAVCalendarKey,
  normalizeCalDAVServerHost,
  resolveCalDAVServerHost,
} from "./shared/calendar-identity";
export {
  CalDAVUnreadableResourceError,
  eventToICalString,
  parseICalToRemoteEvent,
  parseICalToRemoteEvents,
} from "./shared/ics";

export type {
  CalDAVProviderOptions,
  CalDAVProviderConfig,
  CalDAVAccount,
  CalDAVServiceConfig,
  CalDAVService,
  CalDAVClientConfig,
  CalendarInfo,
  CalDAVSourceAccount,
  CalDAVSourceConfig,
  CalDAVSourceProviderConfig,
  CalDAVSourceSyncResult,
} from "./types";

export type { CalDAVSourceProvider } from "./source/provider";
export type { CalDAVSourceService } from "./source/sync";
