import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

type KeeperDatabase = BunSQLDatabase;

interface KeeperEventRangeInput {
  from: Date | string;
  to: Date | string;
}

interface KeeperSource {
  id: string;
  name: string;
  calendarType: string;
  capabilities: string[];
  accountId: string;
  provider: string;
  displayName: string | null;
  email: string | null;
  accountIdentifier: string;
  needsReauthentication: boolean;
  includeInIcalFeed: boolean;
  providerName: string;
  providerIcon: string | null;
  accountLabel: string;
}

interface KeeperDestination {
  id: string;
  provider: string;
  email: string | null;
  needsReauthentication: boolean;
}

interface KeeperMapping {
  id: string;
  sourceCalendarId: string;
  destinationCalendarId: string;
  createdAt: string;
  calendarType: string;
}

interface KeeperEvent {
  id: string;
  startTime: string;
  endTime: string;
  title: string | null;
  description: string | null;
  location: string | null;
  calendarId: string;
  calendarName: string;
  calendarProvider: string;
  calendarUrl: string | null;
}

interface KeeperSyncStatus {
  calendarId: string;
  inSync: boolean;
  lastSyncedAt: string | null;
  localEventCount: number;
  remoteEventCount: number;
}

interface KeeperApi {
  listSources: (userId: string) => Promise<KeeperSource[]>;
  listDestinations: (userId: string) => Promise<KeeperDestination[]>;
  listMappings: (userId: string) => Promise<KeeperMapping[]>;
  getEventsInRange: (userId: string, range: KeeperEventRangeInput) => Promise<KeeperEvent[]>;
  getEventCount: (userId: string) => Promise<number>;
  getSyncStatuses: (userId: string) => Promise<KeeperSyncStatus[]>;
}

export type {
  KeeperApi,
  KeeperDatabase,
  KeeperDestination,
  KeeperEvent,
  KeeperEventRangeInput,
  KeeperMapping,
  KeeperSource,
  KeeperSyncStatus,
};
