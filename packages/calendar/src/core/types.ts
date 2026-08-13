import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { IcsDuration, IcsExceptionDates, IcsRecurrenceRule } from "ts-ics";
import type { EditableEventContentSnapshot } from "./events/content-hash";
import type { RefreshLockStore } from "./oauth/refresh-coordinator";

type AuthType = "oauth" | "caldav" | "none";
type EventAvailability = "busy" | "free" | "oof" | "workingElsewhere";
type SourceEventType = "default" | "focusTime" | "outOfOffice" | "workingLocation";

interface SourcePreferenceOption {
  id: string;
  label: string;
  description?: string;
  defaultValue: boolean;
  disabled?: boolean;
}

interface SourcePreferencesConfig {
  label: string;
  description?: string;
  options: SourcePreferenceOption[];
}

interface CalDAVProviderConfig {
  serverUrl: string;
  usernameLabel: string;
  usernameHelp: string;
  passwordLabel: string;
  passwordHelp: string;
}

interface ProviderCapabilities {
  canRead: boolean;
  canWrite: boolean;
}

interface ProviderDefinition {
  id: string;
  name: string;
  authType: AuthType;
  icon?: string;
  comingSoon?: boolean;
  caldav?: CalDAVProviderConfig;
  sourcePreferences?: SourcePreferencesConfig;
  capabilities: ProviderCapabilities;
}

interface SyncableEvent {
  id: string;
  /** The persisted event_states row that owns this logical event. */
  eventStateId?: string;
  sourceEventUid: string;
  startTime: Date;
  endTime: Date;
  availability?: EventAvailability;
  isAllDay?: boolean;
  startTimeZone?: string;
  recurrenceDuration?: IcsDuration;
  recurrenceRule?: IcsRecurrenceRule;
  exceptionDates?: Date[];
  recurrenceId?: Date;
  summary: string;
  description?: string;
  location?: string;
  calendarId: string;
  calendarName: string | null;
  calendarUrl: string | null;
}

type MaterializedSyncableEvent = Omit<
  SyncableEvent,
  "exceptionDates" | "recurrenceDuration" | "recurrenceId" | "recurrenceRule"
> & {
  exceptionDates?: never;
  recurrenceDuration?: never;
  recurrenceId?: never;
  recurrenceRule?: never;
};

interface PushResult {
  success: boolean;
  remoteId?: string;
  deleteId?: string;
  echo?: PushEchoComparison;
  error?: string;
  errorType?: string;
  statusCode?: number;
  shouldContinue?: boolean;
  conflictResolved?: boolean;
}

interface PushEchoFieldDivergence {
  allDay: boolean;
  description: boolean;
  end: boolean;
  location: boolean;
  start: boolean;
  summary: boolean;
}

type PushEchoUncomparableReason =
  | "echo-body-missing"
  | "echo-not-parseable"
  | "echo-times-missing"
  | "echo-body-not-text";

type PushEchoComparison =
  | { comparable: true; divergence: PushEchoFieldDivergence }
  | { comparable: false; reason: PushEchoUncomparableReason };

interface DeleteResult {
  success: boolean;
  error?: string;
  errorType?: string;
  statusCode?: number;
  shouldContinue?: boolean;
}

interface ProviderThrottleMetrics {
  retryCount: number;
  retryAfterMs: number;
}

interface SyncResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
}

interface RemoteEvent {
  uid: string;
  deleteId: string;
  startTime: Date;
  endTime: Date;
  isKeeperEvent: boolean;
  editableContent?: EditableEventContentSnapshot;
  editableContentHash?: string;
  editableAvailability?: EventAvailability;
  supportedAvailabilities?: EventAvailability[];
}

type SyncOperation =
  | { type: "add"; event: MaterializedSyncableEvent; staleMappingId?: string }
  | { type: "remove"; uid: string; deleteId: string; startTime: Date; mappingId?: string }
  | {
    type: "replace";
    event: MaterializedSyncableEvent;
    staleMappingId: string;
    uid: string;
    deleteId: string;
  };

interface ListRemoteEventsOptions {
  timeMin: Date;
}

type BroadcastSyncStatus = (
  userId: string,
  calendarId: string,
  data: { needsReauthentication: boolean },
) => void;

interface ProviderConfig {
  database: BunSQLDatabase;
  userId: string;
  calendarId: string;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

interface OAuthProviderConfig extends ProviderConfig {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshLockStore?: RefreshLockStore | null;
}

interface GoogleCalendarConfig extends OAuthProviderConfig {
  externalCalendarId: string;
}

type OutlookCalendarConfig = OAuthProviderConfig;

interface CalDAVConfig extends ProviderConfig {
  serverUrl: string;
  username: string;
  calendarUrl: string;
}

interface SourceEvent {
  uid: string;
  sourceEventId?: string;
  startTime: Date;
  endTime: Date;
  sourceEventType?: SourceEventType;
  availability?: EventAvailability;
  isAllDay?: boolean;
  startTimeZone?: string;
  recurrenceDuration?: IcsDuration;
  recurrenceRule?: IcsRecurrenceRule;
  exceptionDates?: IcsExceptionDates;
  recurrenceId?: Date;
  title?: string;
  description?: string;
  location?: string;
}

export type {
  AuthType,
  EventAvailability,
  SourceEventType,
  CalDAVProviderConfig,
  ProviderCapabilities,
  ProviderDefinition,
  SourcePreferenceOption,
  SourcePreferencesConfig,
  SyncableEvent,
  MaterializedSyncableEvent,
  ProviderThrottleMetrics,
  PushEchoComparison,
  PushEchoFieldDivergence,
  PushEchoUncomparableReason,
  PushResult,
  DeleteResult,
  SyncResult,
  RemoteEvent,
  SyncOperation,
  ListRemoteEventsOptions,
  BroadcastSyncStatus,
  ProviderConfig,
  OAuthProviderConfig,
  GoogleCalendarConfig,
  OutlookCalendarConfig,
  CalDAVConfig,
  SourceEvent,
};
