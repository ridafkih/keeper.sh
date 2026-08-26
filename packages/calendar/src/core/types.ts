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
 * Whether the DESTINATION itself said anything about this object. A status number cannot carry
 * this: a batch sub-response that never arrived is reported as status 0, which reads like a
 * verdict and is not one. Only "answered" is evidence about the object; "unanswered" means the
 * request reached no destination that had a say, so nothing at all was learned.
 */
type DestinationAnswer = "answered" | "unanswered";

interface PushResult {
  success: boolean;
  destinationAnswer?: DestinationAnswer;
  /* False when the failure was raised while building the request - a serializer that refused the
     event, a body that could not be encoded - so no request for this object ever left the process.
     Nothing was learned about the destination's copy, and no number of repetitions can turn that
     into evidence. Absent means the provider does not report it. */
  requestSent?: boolean;
  remoteId?: string;
  deleteId?: string;
  /* Which observation named the object this result points at. "echo" is the destination's own
     answer to the write; "read" is a follow-up read of the destination, which is the only way back
     to an object a create already put on the calendar under an answer that could not be parsed.
     A mapping recovered by reading is the only thing standing between the customer and a second
     permanent copy on a create-only push, so it is written down once and immediately. */
  identitySource?: "echo" | "read";
  echo?: PushEchoComparison;
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
  /* An edit that landed on the mirror the mapping already names. It is kept apart from `added`
     because `added` is what an operator watches for duplicate churn on a create-only destination,
     while a run that repaired mirrors in place still did successful work: without its own counter
     an all-update run reads as zero successes and suspends the whole destination for six hours. */
  updated: number;
  removed: number;
  removeFailed: number;
  /* Failures nobody can act on: the destination will refuse this one event on every future cycle
     too. They are still reported, but they must not grade the whole calendar failed, or one such
     event backs every other event on it off to the six-hour ceiling for ever. */
  parked?: number;
}

interface RemoteEvent {
  uid: string;
  deleteId: string;
  /* The mirror's own title, carried beside the content snapshot so a presence answer names the
     object it found without the caller having to unpack the snapshot to identify it. */
  summary?: string;
  startTime: Date;
  endTime: Date;
  isKeeperEvent: boolean;
  editableContent?: EditableEventContentSnapshot;
  editableContentHash?: string;
  editableAvailability?: EventAvailability;
  supportedAvailabilities?: EventAvailability[];
}

/* Absence must rest on positive evidence, so "unknown" stays distinct from "absent": a transient failure,
   a rate limit or an exhausted budget must never be read as proof the object is gone. "elsewhere" is
   evidence of the opposite kind: the object was found, but outside the calendar the sync owns, so it
   may never license a create and must stay distinguishable from a mirror found in the destination. */
type EventPresenceStatus = "absent" | "elsewhere" | "present" | "unknown";

interface EventPresence {
  event?: RemoteEvent;
  identifier: string;
  status: EventPresenceStatus;
}

/* A mirror is named by a pair: the id a delete would target, and the uid the mapping carries.
   Graph re-keys an item on a move, so the id alone can never tell a moved mirror from a deleted one. */
interface EventVerificationTarget {
  deleteId: string;
  uid?: string;
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
    remoteMissing?: boolean;
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
  DestinationAnswer,
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
  DeleteResult,
  SyncResult,
  RemoteEvent,
  EventPresence,
  EventPresenceStatus,
  EventVerificationTarget,
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
