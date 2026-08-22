import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { FreeSlot, WorkingHours } from "@/utils/free-time";

type KeeperDatabase = BunSQLDatabase;

interface KeeperEventRangeInput {
  from: Date | string;
  to: Date | string;
}

interface KeeperEventFilters {
  calendarId?: string[];
  availability?: string[];
  isAllDay?: boolean;
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
  unavailableSince: Date | null;
  disabled: boolean;
  providerMissingSince: string | null;
  providerName: string;
  providerIcon: string | null;
  accountLabel: string;
}

interface KeeperEvent {
  id: string;
  /** Persisted event_states UUID for synced events; null for user-created events. */
  eventStateId: string | null;
  startTime: string;
  endTime: string;
  /** Whole-day event: `startTime`/`endTime` are the UTC-midnight day bounds. */
  isAllDay: boolean;
  title: string | null;
  description: string | null;
  location: string | null;
  calendarId: string;
  calendarName: string;
  calendarProvider: string;
  calendarUrl: string | null;
}

interface KeeperFreeTimeOptions {
  durationMinutes: number;
  timezone: string;
  workingHours: WorkingHours | null;
  ignoreAllDayEvents: boolean;
  limit: number;
}

interface KeeperFreeTimeResult {
  from: string;
  to: string;
  timezone: string;
  durationMinutes: number;
  slots: FreeSlot[];
}

interface KeeperSyncTriggerResult {
  triggered: boolean;
  sourcesRefreshed: number;
}

interface KeeperCalendarPauseResult {
  calendarId: string;
  paused: boolean;
}

interface KeeperSyncStatus {
  calendarId: string;
  inSync: boolean;
  lastSyncedAt: string | null;
  localEventCount: number;
  remoteEventCount: number;
}

interface EventInput {
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  isAllDay?: boolean;
  availability?: "busy" | "free";
  startTimeZone?: string;
}

interface EventUpdateInput {
  title?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  isAllDay?: boolean;
  availability?: "busy" | "free";
  startTimeZone?: string;
}

type RsvpStatus = "accepted" | "declined" | "tentative";

interface EventActionResult {
  success: boolean;
  error?: string;
}

interface ProviderEventReference {
  sourceEventId: string | null;
  sourceEventUid: string;
}

interface EventCreateResult extends EventActionResult {
  event?: KeeperEvent;
}

interface PendingInvite {
  sourceEventUid: string;
  title: string | null;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  organizer: string | null;
  calendarId: string;
  provider: string;
}

interface ProviderCredentials {
  provider: string;
  calendarId: string;
  accountId: string;
  externalCalendarId: string | null;
  calendarUrl: string | null;
  email: string | null;
  oauth?: {
    credentialId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  };
  caldav?: {
    authMethod: string;
    serverUrl: string;
    username: string;
    encryptedPassword: string;
  };
}

interface KeeperApi {
  listSources: (userId: string) => Promise<KeeperSource[]>;
  getEventsInRange: (userId: string, range: KeeperEventRangeInput, filters?: KeeperEventFilters) => Promise<KeeperEvent[]>;
  getEvent: (userId: string, eventId: string) => Promise<KeeperEvent | null>;
  getEventCount: (userId: string, options?: { from: Date; to: Date }) => Promise<number>;
  findFreeTime: (
    userId: string,
    range: KeeperEventRangeInput,
    options: KeeperFreeTimeOptions,
    filters?: KeeperEventFilters,
  ) => Promise<KeeperFreeTimeResult>;
  getSyncStatuses: (userId: string) => Promise<KeeperSyncStatus[]>;
  createEvent: (userId: string, input: EventInput) => Promise<EventCreateResult>;
  updateEvent: (userId: string, eventId: string, updates: EventUpdateInput) => Promise<EventActionResult>;
  deleteEvent: (userId: string, eventId: string) => Promise<EventActionResult>;
  rsvpEvent: (userId: string, eventId: string, status: RsvpStatus) => Promise<EventActionResult>;
  getPendingInvites: (userId: string, calendarId: string, from: string, to: string) => Promise<PendingInvite[]>;
}

export type {
  EventActionResult,
  EventCreateResult,
  EventInput,
  EventUpdateInput,
  KeeperApi,
  KeeperCalendarPauseResult,
  KeeperDatabase,
  KeeperEvent,
  KeeperEventFilters,
  KeeperEventRangeInput,
  KeeperFreeTimeOptions,
  KeeperFreeTimeResult,
  KeeperSyncTriggerResult,
  KeeperSource,
  KeeperSyncStatus,
  PendingInvite,
  ProviderCredentials,
  ProviderEventReference,
  RsvpStatus,
};
