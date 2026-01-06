export { createCalDAVProvider } from "./destination/provider";
export { createCalDAVService } from "./destination/sync";

export { createCalDAVSourceProvider } from "./source/provider";
export { createCalDAVSourceService } from "./source/sync";

export { CalDAVClient, createCalDAVClient } from "./shared/client";
export { eventToICalString, parseICalToRemoteEvent } from "./shared/ics";

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
