import { type } from "arktype";

const proxyableMethods = type("'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS'");

type ProxyableMethods = typeof proxyableMethods.infer;

const planSchema = type("'free' | 'pro'");
type Plan = typeof planSchema.infer;

const SYNC_RANGE_DEFINITIONS = [
  { label: "1 Week", shift: { amount: 7, unit: "days" }, value: "1_week" },
  { label: "1 Month", shift: { amount: 1, unit: "months" }, value: "1_month" },
  { label: "3 Months", shift: { amount: 3, unit: "months" }, value: "3_months" },
  { label: "6 Months", shift: { amount: 6, unit: "months" }, value: "6_months" },
  { label: "12 Months", shift: { amount: 12, unit: "months" }, value: "12_months" },
  { label: "2 Years", shift: { amount: 24, unit: "months" }, value: "2_years" },
] as const;

const DEFAULT_HISTORIC_SYNC_RANGE = "1_month" as const;
const DEFAULT_FUTURE_SYNC_RANGE = "2_years" as const;

const DEFAULT_FEED_SETTINGS = {
  includeEventName: false,
  includeEventDescription: false,
  includeEventLocation: false,
  excludeAllDayEvents: false,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  customEventName: "Busy",
} as const;

const DEFAULT_FEED_NAME = "My Calendar" as const;

/* A feed name is shown to the user and must survive a round trip, so an
 * all-whitespace name is rejected rather than silently stored. */
const icalFeedNameSchema = type("string >= 1").narrow(
  (value) => value.trim().length > 0,
);

const syncRangeSchema = type.enumerated(
  ...SYNC_RANGE_DEFINITIONS.map(({ value }) => value),
);
type SyncRange = typeof syncRangeSchema.infer;

const billingPeriodSchema = type("'monthly' | 'yearly'");
type BillingPeriod = typeof billingPeriodSchema.infer;

const feedbackRequestSchema = type({
  message: "string",
  type: "'feedback' | 'report'",
  "wantsFollowUp?": "boolean",
  "+": "reject",
});
type FeedbackRequest = typeof feedbackRequestSchema.infer;

const createSourceSchema = type({
  name: "string",
  url: "string",
  "+": "reject",
});

type CreateSource = typeof createSourceSchema.infer;

const stringSchema = type("string");

const googleEventSchema = type({
  "description?": "string",
  "end?": { "date?": "string", "dateTime?": "string", "timeZone?": "string" },
  "eventType?": "string",
  "iCalUID?": "string",
  "id?": "string",
  "location?": "string",
  "recurrence?": "string[]",
  "start?": { "date?": "string", "dateTime?": "string", "timeZone?": "string" },
  "status?": "'confirmed' | 'tentative' | 'cancelled'",
  "summary?": "string",
  "transparency?": "string",
  "visibility?": "string",
  "workingLocationProperties?": {
    "customLocation?": { "label?": "string" },
    "homeOffice?": "unknown",
    "officeLocation?": { "buildingId?": "string", "deskId?": "string", "floorId?": "string", "floorSectionId?": "string", "label?": "string" },
    "type?": "string",
  },
});
type GoogleEvent = typeof googleEventSchema.infer;

const googleEventListSchema = type({
  "items?": googleEventSchema.array(),
  "nextPageToken?": "string",
  "nextSyncToken?": "string",
});
type GoogleEventList = typeof googleEventListSchema.infer;

const googleAttendeeSchema = type({
  "email?": "string",
  "responseStatus?": "string",
  "self?": "boolean",
});
type GoogleAttendee = typeof googleAttendeeSchema.infer;

const googleEventWithAttendeesSchema = googleEventSchema.and({
  "attendees?": googleAttendeeSchema.array(),
  "attendeesOmitted?": "boolean",
  "creator?": { "email?": "string", "displayName?": "string", "self?": "boolean" },
  "organizer?": {
    "displayName?": "string",
    "email?": "string",
    "self?": "boolean",
  },
});
type GoogleEventWithAttendees = typeof googleEventWithAttendeesSchema.infer;

const googleEventWithAttendeesListSchema = type({
  "items?": googleEventWithAttendeesSchema.array(),
  "nextPageToken?": "string",
});
type GoogleEventWithAttendeesList = typeof googleEventWithAttendeesListSchema.infer;

const googleApiErrorSchema = type({
  "error?": {
    "code?": "number",
    "message?": "string",
    "status?": "string",
    "errors?": type({ "reason?": "string" }).array(),
    "details?": type({ "reason?": "string" }).array(),
  },
});
type GoogleApiError = typeof googleApiErrorSchema.infer;

const googleTokenResponseSchema = type({
  access_token: "string",
  expires_in: "number",
  "refresh_token?": "string",
  scope: "string",
  token_type: "string",
});
type GoogleTokenResponse = typeof googleTokenResponseSchema.infer;

const googleUserInfoSchema = type({
  email: "string",
  "family_name?": "string",
  "given_name?": "string",
  id: "string",
  "name?": "string",
  "picture?": "string",
  "verified_email?": "boolean",
});
type GoogleUserInfo = typeof googleUserInfoSchema.infer;

const microsoftTokenResponseSchema = type({
  access_token: "string",
  expires_in: "number",
  "refresh_token?": "string",
  scope: "string",
  token_type: "string",
});
type MicrosoftTokenResponse = typeof microsoftTokenResponseSchema.infer;

const microsoftUserInfoSchema = type({
  "displayName?": "string",
  id: "string",
  "mail?": "string | null",
  "userPrincipalName?": "string",
});
type MicrosoftUserInfo = typeof microsoftUserInfoSchema.infer;

const outlookEventSchema = type({
  "@removed?": { "reason?": "'deleted' | 'changed'" },
  "body?": type({ "content?": "string", "contentType?": "string" }).or(type("null")),
  "categories?": "string[]",
  "createdDateTime?": "string",
  "end?": { "dateTime?": "string", "timeZone?": "string" },
  "iCalUId?": "string | null",
  "id?": "string",
  "isAllDay?": "boolean",
  "isCancelled?": "boolean",
  "lastModifiedDateTime?": "string",
  "location?": { "displayName?": "string" },
  "originalEndTimeZone?": "string",
  "originalStartTimeZone?": "string",
  "showAs?": "string",
  "start?": { "dateTime?": "string", "timeZone?": "string" },
  "subject?": "string | null",
  "seriesMasterId?": "string | null",
  "type?": "string",
});
type OutlookEvent = typeof outlookEventSchema.infer;

const outlookAttendeeSchema = type({
  "emailAddress?": { "address?": "string", "name?": "string" },
  "status?": { "response?": "string" },
  "type?": "string",
});
type OutlookAttendee = typeof outlookAttendeeSchema.infer;

const outlookEventWithAttendeesSchema = outlookEventSchema.and({
  "attendees?": outlookAttendeeSchema.array(),
  "isOrganizer?": "boolean",
  "organizer?": { "emailAddress?": { "address?": "string", "name?": "string" } },
});
type OutlookEventWithAttendees = typeof outlookEventWithAttendeesSchema.infer;

const outlookEventWithAttendeesListSchema = type({
  "value?": outlookEventWithAttendeesSchema.array(),
});
type OutlookEventWithAttendeesList = typeof outlookEventWithAttendeesListSchema.infer;

const outlookEventListSchema = type({
  "@odata.deltaLink?": "string",
  "@odata.nextLink?": "string",
  "value?": outlookEventSchema.array(),
});
type OutlookEventList = typeof outlookEventListSchema.infer;

const outlookCalendarViewEventSchema = type({
  "id?": "string",
  "iCalUId?": "string | null",
  "subject?": "string | null",
  "bodyPreview?": "string",
  "location?": { "displayName?": "string" },
  "start?": { "dateTime?": "string", "timeZone?": "string" },
  "end?": { "dateTime?": "string", "timeZone?": "string" },
  "isAllDay?": "boolean",
  "responseStatus?": { "response?": "string" },
  "organizer?": { "emailAddress?": { "address?": "string", "name?": "string" } },
});
type OutlookCalendarViewEvent = typeof outlookCalendarViewEventSchema.infer;

const outlookCalendarViewListSchema = type({
  "value?": outlookCalendarViewEventSchema.array(),
  "@odata.nextLink?": "string",
});
type OutlookCalendarViewList = typeof outlookCalendarViewListSchema.infer;

const microsoftApiErrorSchema = type({
  "error?": { "code?": "string", "message?": "string" },
});
type MicrosoftApiError = typeof microsoftApiErrorSchema.infer;

const authSocialProvidersSchema = type({
  google: "boolean",
  microsoft: "boolean",
  "+": "reject",
});
type AuthSocialProviders = typeof authSocialProvidersSchema.infer;

const authCapabilitiesSchema = type({
  commercialMode: "boolean",
  credentialMode: "'email' | 'username'",
  requiresEmailVerification: "boolean",
  socialProviders: authSocialProvidersSchema,
  supportsChangePassword: "boolean",
  supportsPasskeys: "boolean",
  supportsPasswordReset: "boolean",
  "+": "reject",
});
type AuthCapabilities = typeof authCapabilitiesSchema.infer;

const socketMessageSchema = type({
  "data?": "unknown",
  event: "string",
});
type SocketMessage = typeof socketMessageSchema.infer;

const syncOperationSchema = type({
  eventTime: "string",
  type: "'add' | 'remove'",
});
type SyncOperation = typeof syncOperationSchema.infer;

const syncStatusSchema = type({
  destinationId: "string",
  "error?": "string",
  inSync: "boolean",
  "lastOperation?": syncOperationSchema,
  "lastSyncedAt?": "string",
  localEventCount: "number",
  "needsReauthentication?": "boolean",
  "progress?": { current: "number", total: "number" },
  remoteEventCount: "number",
  "stage?": "'fetching' | 'comparing' | 'processing' | 'error'",
  status: "'idle' | 'syncing' | 'error'",
});
type SyncStatus = typeof syncStatusSchema.infer;

const syncAggregateSchema = type({
  "emittedAt?": "string",
  progressPercent: "number",
  seq: "number",
  syncEventsProcessed: "number",
  syncEventsRemaining: "number",
  syncEventsTotal: "number",
  syncing: "boolean",
  "lastSyncedAt?": "string | null",
});
type SyncAggregate = typeof syncAggregateSchema.infer;

const broadcastMessageSchema = type({
  data: "unknown",
  event: "string",
  userId: "string",
});
type BroadcastMessage = typeof broadcastMessageSchema.infer;

const userSchema = type({
  "email?": "string",
  "emailVerified?": "boolean",
  id: "string",
  "name?": "string",
  "username?": "string",
});
type User = typeof userSchema.infer;

const signUpBodySchema = type({
  email: "string",
  "name?": "string",
  "password?": "string",
  "+": "reject",
});
type SignUpBody = typeof signUpBodySchema.infer;

const caldavDiscoverRequestSchema = type({
  password: "string",
  serverUrl: "string",
  username: "string",
  "+": "reject",
});
type CalDAVDiscoverRequest = typeof caldavDiscoverRequestSchema.infer;

const caldavConnectRequestSchema = type({
  calendarUrl: "string",
  password: "string",
  "provider?": "string",
  serverUrl: "string",
  username: "string",
  "+": "reject",
});
type CalDAVConnectRequest = typeof caldavConnectRequestSchema.infer;

const updateSourceDestinationsSchema = type({
  destinationIds: "string[]",
  "+": "reject",
});
type UpdateSourceDestinations = typeof updateSourceDestinationsSchema.infer;

const checkoutSuccessEventSchema = type({
  "currency?": "string",
  "id?": "string",
  "totalAmount?": "number",
});
type CheckoutSuccessEvent = typeof checkoutSuccessEventSchema.infer;

const googleCalendarListEntrySchema = type({
  accessRole: "'freeBusyReader' | 'reader' | 'writer' | 'owner'",
  "backgroundColor?": "string",
  "description?": "string",
  "foregroundColor?": "string",
  id: "string",
  "primary?": "boolean",
  "summary?": "string",
});
type GoogleCalendarListEntry = typeof googleCalendarListEntrySchema.infer;

/*
 * Google omits empty arrays, and entries are validated one by one so an unusual calendar
 * costs that calendar rather than the whole account.
 */
const googleCalendarListResponseSchema = type({
  "items?": "unknown[]",
  kind: "'calendar#calendarList'",
  "nextPageToken?": "string",
});
type GoogleCalendarListResponse = typeof googleCalendarListResponseSchema.infer;

const createOAuthSourceSchema = type({
  "destinationId?": "string",
  externalCalendarId: "string",
  name: "string",
  "oauthSourceCredentialId?": "string",
  "syncFocusTime?": "boolean",
  "syncOutOfOffice?": "boolean",
  "+": "reject",
});
type CreateOAuthSource = typeof createOAuthSourceSchema.infer;

const createCalDAVSourceSchema = type({
  authMethod: "'basic' | 'digest'",
  calendarUrl: "string",
  name: "string",
  password: "string",
  provider: "'caldav' | 'fastmail' | 'icloud'",
  serverUrl: "string",
  username: "string",
  "+": "reject",
});
type CreateCalDAVSource = typeof createCalDAVSourceSchema.infer;

const caldavDiscoverSourceSchema = type({
  password: "string",
  serverUrl: "string",
  username: "string",
  "+": "reject",
});
type CalDAVDiscoverSource = typeof caldavDiscoverSourceSchema.infer;

const oauthCalendarSourceSchema = type({
  createdAt: "string",
  destinationId: "string",
  email: "string | null",
  externalCalendarId: "string",
  id: "string",
  name: "string",
  provider: "string",
});
type OAuthCalendarSource = typeof oauthCalendarSourceSchema.infer;

const updateOAuthSourceDestinationsSchema = type({
  destinationIds: "string[]",
  "+": "reject",
});
type UpdateOAuthSourceDestinations = typeof updateOAuthSourceDestinationsSchema.infer;

/*
 * ICS recurrence-related shapes mirroring ts-ics's IcsDateObject and IcsRecurrenceRule.
 * Date fields use `string.date.iso.parse` so values stored as ISO strings in JSON text
 * are validated and morphed back into Date instances on read — ts-ics requires real Date
 * objects on its in-memory shape.
 */
const icsWeekDaySchema = type("'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA'");

const icsDateObjectSchema = type({
  date: "string.date.iso.parse",
  "type?": "'DATE' | 'DATE-TIME'",
  "local?": {
    date: "string.date.iso.parse",
    timezone: "string",
    tzoffset: "string",
  },
});
type StoredIcsDateObject = typeof icsDateObjectSchema.infer;

const icsDurationSchema = type({
  "before?": "boolean",
  "weeks?": "number",
  "days?": "number",
  "hours?": "number",
  "minutes?": "number",
  "seconds?": "number",
});

const icsRecurrenceRuleSchema = type({
  frequency: "'SECONDLY' | 'MINUTELY' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'",
  "until?": icsDateObjectSchema,
  "count?": "number",
  "interval?": "number",
  "bySecond?": "number[]",
  "byMinute?": "number[]",
  "byHour?": "number[]",
  "byDay?": type({ day: icsWeekDaySchema, "occurrence?": "number" }).array(),
  "byMonthday?": "number[]",
  "byYearday?": "number[]",
  "byWeekNo?": "number[]",
  "byMonth?": "number[]",
  "bySetPos?": "number[]",
  "workweekStart?": icsWeekDaySchema,
});
const storedIcsRecurrenceRuleSchema = icsRecurrenceRuleSchema.and({
  "recurrenceDuration?": icsDurationSchema,
});
type StoredIcsRecurrenceRule = typeof storedIcsRecurrenceRuleSchema.infer;

const icsExceptionDatesSchema = icsDateObjectSchema.array();
type StoredIcsExceptionDates = typeof icsExceptionDatesSchema.infer;

const DEFAULT_SOURCE_SYNC_RULES = {
  customEventName: "{{calendar_name}}",
  excludeEventDescription: true,
  excludeEventLocation: true,
  excludeEventName: true,
  includeInIcalFeed: true,
} as const;

/*
 * "push" on a source calendar is what two-way sync is offered on, so a calendar the
 * account may only read must never carry it: the offer would promise the user a write the
 * provider refuses. Every path that records a source calendar derives it here.
 */
const resolveSourceCalendarCapabilities = (writable: boolean): string[] => {
  if (writable) {
    return ["pull", "push"];
  }
  return ["pull"];
};

const applySourceSyncDefaults = <TValues extends object>(
  values: TValues,
): TValues & typeof DEFAULT_SOURCE_SYNC_RULES => ({
  ...DEFAULT_SOURCE_SYNC_RULES,
  ...values,
});

const apiErrorBodySchema = type({ error: "string | null" });
type ApiErrorBody = typeof apiErrorBodySchema.infer;

const readApiErrorMessage = (body: unknown): string | null => {
  if (!apiErrorBodySchema.allows(body)) {
    return null;
  }
  return body.error;
};
const pushChannelStateSchema = type(
  "'active' | 'degraded' | 'failed' | 'registering' | 'removed'",
);
type PushChannelStateValue = typeof pushChannelStateSchema.infer;

const graphNotificationSchema = type({
  subscriptionId: "string",
  "changeType?": "string",
  "clientState?": "string | null",
  "id?": "string",
  "lifecycleEvent?": "string",
  "resource?": "string",
  "resourceData?": "unknown",
  "subscriptionExpirationDateTime?": "string",
  "tenantId?": "string",
});
type GraphNotification = typeof graphNotificationSchema.infer;

const graphNotificationCollectionSchema = type({
  value: graphNotificationSchema.array(),
});
type GraphNotificationCollection = typeof graphNotificationCollectionSchema.infer;

const googleWatchHeadersSchema = type({
  channelId: "string",
  token: "string",
  "messageNumber?": "string",
  "resourceId?": "string",
  "resourceState?": "string",
});
type GoogleWatchHeaders = typeof googleWatchHeadersSchema.infer;

/*
 * The one description of what two-way sync writes to a real calendar. The applier builds
 * its payload from this list and the dashboard builds its sentence from it, so a field the
 * pass can write to a source event cannot be one the product forgot to tell the user about:
 * adding a name to WriteBackFieldName without a label here fails to type-check.
 */
const WRITE_BACK_PROJECTION_IDENTITY_FIELDS = [
  "endTime",
  "isAllDay",
  "startTime",
  "startTimeZone",
] as const;

const WRITE_BACK_REDACTABLE_FIELDS = [
  { exclusion: "excludeEventName", field: "summary" },
  { exclusion: "excludeEventDescription", field: "description" },
  { exclusion: "excludeEventLocation", field: "location" },
] as const;

type WriteBackFieldName =
  | typeof WRITE_BACK_PROJECTION_IDENTITY_FIELDS[number]
  | typeof WRITE_BACK_REDACTABLE_FIELDS[number]["field"];

interface WriteBackFieldExclusions {
  excludeEventDescription: boolean;
  excludeEventLocation: boolean;
  excludeEventName: boolean;
}

/*
 * The zone is not an axis a user edits: it travels beside the instants so a provider handed
 * a bare instant does not re-home the event, and naming it in the sentence would describe a
 * change nobody can make.
 */
const WRITE_BACK_FIELD_LABELS: Record<WriteBackFieldName, string | null> = {
  description: "description",
  endTime: "time",
  isAllDay: "all-day",
  location: "location",
  startTime: "date",
  startTimeZone: null,
  summary: "title",
};

const WRITE_BACK_DISCLOSURE_ORDER: WriteBackFieldName[] = [
  "summary",
  "description",
  "location",
  "startTime",
  "endTime",
  "isAllDay",
  "startTimeZone",
];

const resolveWriteBackFieldNames = (
  exclusions: WriteBackFieldExclusions,
): Set<WriteBackFieldName> =>
  new Set<WriteBackFieldName>([
    ...WRITE_BACK_PROJECTION_IDENTITY_FIELDS,
    ...WRITE_BACK_REDACTABLE_FIELDS
      .filter(({ exclusion }) => !exclusions[exclusion])
      .map(({ field }) => field),
  ]);

/*
 * Two-way sync writes to the source calendar, so the account must hold the same write
 * capability every other write path requires — a calendar shared read-only carries "pull"
 * alone and would reject every write-back at the provider. The rule is declared once so
 * the dashboard cannot offer a control the API refuses, or the reverse.
 */
const UNWRITABLE_SOURCE_CALENDAR_TYPE = "ical";

const isWriteBackCapableSource = (
  source:
    | {
      calendarType: string;
      capabilities: readonly string[];
    }
    | null,
): boolean => {
  if (!source) {
    return false;
  }
  return source.calendarType !== UNWRITABLE_SOURCE_CALENDAR_TYPE
    && source.capabilities.includes("pull")
    && source.capabilities.includes("push");
};

/*
 * A source can lose write access long after two-way was switched on — a shared calendar
 * regraded to reader, a revoked role — and rediscovery rewrites the capabilities without
 * touching the mode the pair stored. The stored mode is kept so it returns with the
 * access, and every reader resolves it through here so an unwritable source is offered as
 * off to the screen and to the write-back pass alike.
 */
/*
 * Pausing a calendar is the documented way to make Keeper.sh stop touching it: nothing is
 * read from it or written to it while paused. A paused source is also a source Keeper.sh
 * has stopped re-reading, so the stored snapshot it would compare against is frozen and
 * every "refuse if the original moved" guard downstream is comparing it against itself.
 */
const resolveWritableWriteBackMode = <Mode extends string>(
  writeBackMode: Mode,
  source:
    | {
      calendarType: string;
      capabilities: readonly string[];
      disabled?: boolean | null;
      writeBackIdentity?: string | null;
    }
    | null,
): Mode | "off" => {
  if (source?.disabled) {
    return "off";
  }
  if (isWriteBackCapableSource(source)) {
    return writeBackMode;
  }
  return "off";
};

const describeWriteBackFields = (exclusions: WriteBackFieldExclusions): string[] => {
  const eligible = resolveWriteBackFieldNames(exclusions);
  return WRITE_BACK_DISCLOSURE_ORDER
    .filter((field) => eligible.has(field))
    .flatMap((field) => WRITE_BACK_FIELD_LABELS[field] ?? []);
};

export {
  DEFAULT_FEED_NAME,
  DEFAULT_FEED_SETTINGS,
  DEFAULT_SOURCE_SYNC_RULES,
  apiErrorBodySchema,
  applySourceSyncDefaults,
  resolveSourceCalendarCapabilities,
  readApiErrorMessage,
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  SYNC_RANGE_DEFINITIONS,
  proxyableMethods,
  planSchema,
  syncRangeSchema,
  icalFeedNameSchema,
  billingPeriodSchema,
  feedbackRequestSchema,
  createSourceSchema,
  stringSchema,
  googleEventSchema,
  googleEventListSchema,
  googleAttendeeSchema,
  googleEventWithAttendeesSchema,
  googleEventWithAttendeesListSchema,
  googleApiErrorSchema,
  googleTokenResponseSchema,
  googleUserInfoSchema,
  microsoftTokenResponseSchema,
  microsoftUserInfoSchema,
  outlookEventSchema,
  outlookEventListSchema,
  outlookEventWithAttendeesSchema,
  outlookEventWithAttendeesListSchema,
  outlookCalendarViewEventSchema,
  outlookCalendarViewListSchema,
  microsoftApiErrorSchema,
  authSocialProvidersSchema,
  authCapabilitiesSchema,
  socketMessageSchema,
  syncOperationSchema,
  syncStatusSchema,
  syncAggregateSchema,
  broadcastMessageSchema,
  userSchema,
  signUpBodySchema,
  caldavDiscoverRequestSchema,
  caldavConnectRequestSchema,
  updateSourceDestinationsSchema,
  checkoutSuccessEventSchema,
  googleCalendarListEntrySchema,
  googleCalendarListResponseSchema,
  createOAuthSourceSchema,
  createCalDAVSourceSchema,
  caldavDiscoverSourceSchema,
  oauthCalendarSourceSchema,
  updateOAuthSourceDestinationsSchema,
  icsWeekDaySchema,
  icsDateObjectSchema,
  icsDurationSchema,
  icsRecurrenceRuleSchema,
  storedIcsRecurrenceRuleSchema,
  icsExceptionDatesSchema,
  googleWatchHeadersSchema,
  graphNotificationCollectionSchema,
  graphNotificationSchema,
  pushChannelStateSchema,
  describeWriteBackFields,
  isWriteBackCapableSource,
  resolveWritableWriteBackMode,
  resolveWriteBackFieldNames,
  WRITE_BACK_DISCLOSURE_ORDER,
  WRITE_BACK_FIELD_LABELS,
};

export type {
  ProxyableMethods,
  Plan,
  SyncRange,
  BillingPeriod,
  FeedbackRequest,
  CreateSource,
  GoogleEvent,
  GoogleEventList,
  GoogleAttendee,
  GoogleEventWithAttendees,
  GoogleEventWithAttendeesList,
  GoogleApiError,
  GoogleTokenResponse,
  GoogleUserInfo,
  MicrosoftTokenResponse,
  MicrosoftUserInfo,
  OutlookEvent,
  OutlookAttendee,
  OutlookEventList,
  OutlookEventWithAttendees,
  OutlookEventWithAttendeesList,
  OutlookCalendarViewEvent,
  OutlookCalendarViewList,
  MicrosoftApiError,
  AuthSocialProviders,
  AuthCapabilities,
  SocketMessage,
  SyncOperation,
  SyncStatus,
  SyncAggregate,
  BroadcastMessage,
  User,
  SignUpBody,
  CalDAVDiscoverRequest,
  CalDAVConnectRequest,
  UpdateSourceDestinations,
  CheckoutSuccessEvent,
  GoogleCalendarListEntry,
  GoogleCalendarListResponse,
  CreateOAuthSource,
  CreateCalDAVSource,
  CalDAVDiscoverSource,
  OAuthCalendarSource,
  UpdateOAuthSourceDestinations,
  StoredIcsDateObject,
  StoredIcsRecurrenceRule,
  StoredIcsExceptionDates,
  ApiErrorBody,
  GoogleWatchHeaders,
  GraphNotification,
  GraphNotificationCollection,
  PushChannelStateValue,
  WriteBackFieldExclusions,
  WriteBackFieldName,
};
