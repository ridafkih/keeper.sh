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
  isPrivate?: boolean;
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

/*
 * The form a destination reports it stored for a write. It stands in for the read-back the engine
 * would otherwise owe that write, so it carries the times and the availability the destination
 * settled on and not only the hash of the content.
 */
interface StoredEventForm {
  storedAvailability: EventAvailability;
  storedContentHash: string;
  storedEndTime: Date;
  storedStartTime: Date;
}

interface PushResult {
  success: boolean;
  remoteId?: string;
  deleteId?: string;
  echo?: PushEchoComparison;
  storedAvailability?: EventAvailability;
  storedContentHash?: string;
  storedEndTime?: Date;
  storedStartTime?: Date;
  error?: string;
  errorType?: string;
  statusCode?: number;
  shouldContinue?: boolean;
  conflictResolved?: boolean;
}

interface PushEchoValueLengths {
  echo: number;
  sent: number;
}

type PushEchoDivergedLengths = Partial<
  Record<"description" | "location" | "summary", PushEchoValueLengths>
>;

interface PushEchoFieldDivergence {
  allDay: boolean;
  description: boolean;
  end: boolean;
  lengths: PushEchoDivergedLengths;
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
  /* Positive evidence an object actually left the destination. A delete can succeed without
     removing anything (Outlook maps a 404 to success), and only removal licenses a recreate. */
  removedObject?: boolean;
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

/* Absence must rest on positive evidence, so "unknown" stays distinct from "absent": a transient failure,
   a rate limit or an exhausted budget must never be read as proof the object is gone. */
type EventPresenceStatus = "absent" | "present" | "unknown";

interface EventPresence {
  event?: RemoteEvent;
  identifier: string;
  status: EventPresenceStatus;
}

type SyncOperation =
  /*
   * The replaced mapping's recorded baseline — the form, the times and the availability — travels
   * with the operation so a failed capture never falls back to none. A settled form travels with
   * it too: the form the destination was seen holding for the copy this operation replaces, when
   * our own text explains it. So does the form this rewrite is repairing away from, so the next
   * pass can tell our own rewrite of it apart from an edit.
   */
  | {
    type: "add";
    event: MaterializedSyncableEvent;
    staleMappingId?: string;
    recordedAvailability?: EventAvailability;
    recordedContentHash?: string;
    recordedEndTime?: Date;
    recordedStartTime?: Date;
    repairedFromContentHash?: string;
    settledContentHash?: string;
  }
  | { type: "remove"; uid: string; deleteId: string; startTime: Date; mappingId?: string }
  | {
    type: "replace";
    event: MaterializedSyncableEvent;
    staleMappingId: string;
    uid: string;
    deleteId: string;
    remoteMissing?: boolean;
    recordedAvailability?: EventAvailability;
    recordedContentHash?: string;
    recordedEndTime?: Date;
    recordedStartTime?: Date;
    repairedFromContentHash?: string;
    settledContentHash?: string;
  };

interface ListRemoteEventsOptions {
  timeMax: Date;
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
  PushEchoDivergedLengths,
  PushEchoFieldDivergence,
  PushEchoUncomparableReason,
  PushEchoValueLengths,
  PushResult,
  StoredEventForm,
  DeleteResult,
  SyncResult,
  RemoteEvent,
  EventPresence,
  EventPresenceStatus,
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
