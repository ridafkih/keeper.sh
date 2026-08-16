import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  DEFAULT_FEED_NAME,
  DEFAULT_FEED_SETTINGS,
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  SYNC_RANGE_DEFINITIONS,
} from "@keeper.sh/data-schemas";
import { user } from "./auth-schema";

const DEFAULT_EVENT_COUNT = 0;
const WRITE_BACK_MODE_OFF = "off";
const WRITE_BACK_STATE_OK = "ok";

const SYNC_RANGE_SQL_VALUES = SYNC_RANGE_DEFINITIONS
  .map(({ value }) => `'${value}'`)
  .join(", ");

const oauthCredentialsTable = pgTable(
  "oauth_credentials",
  {
    accessToken: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    email: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    needsReauthentication: boolean().notNull().default(false),
    provider: text().notNull(),
    refreshToken: text().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("oauth_credentials_user_idx").on(table.userId),
    index("oauth_credentials_provider_idx").on(table.provider),
    index("oauth_credentials_expires_at_idx").on(table.expiresAt),
  ],
);

const caldavCredentialsTable = pgTable("caldav_credentials", {
  authMethod: text().notNull().default("basic"),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  encryptedPassword: text().notNull(),
  id: uuid().notNull().primaryKey().defaultRandom(),
  serverUrl: text().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  username: text().notNull(),
});

const calendarAccountsTable = pgTable(
  "calendar_accounts",
  {
    accountId: text(),
    authType: text().notNull(),
    caldavCredentialId: uuid().references(() => caldavCredentialsTable.id, {
      onDelete: "cascade",
    }),
    calendarsRefreshAttemptedAt: timestamp({ withTimezone: true }),
    calendarsRefreshedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    displayName: text(),
    email: text(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    needsReauthentication: boolean().notNull().default(false),
    oauthCredentialId: uuid().references(() => oauthCredentialsTable.id, {
      onDelete: "cascade",
    }),
    provider: text().notNull(),
    reauthenticationSource: text(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("calendar_accounts_user_idx").on(table.userId),
    index("calendar_accounts_provider_idx").on(table.provider),
    index("calendar_accounts_needs_reauth_idx").on(table.needsReauthentication),
    uniqueIndex("calendar_accounts_provider_account_idx").on(
      table.userId,
      table.provider,
      table.accountId,
    ),
  ],
);

const calendarsTable = pgTable(
  "calendars",
  {
    accountId: uuid()
      .notNull()
      .references(() => calendarAccountsTable.id, { onDelete: "cascade" }),
    calendarType: text().notNull(),
    calendarUrl: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    excludeAllDayEvents: boolean().notNull().default(false),
    excludeEventDescription: boolean().notNull().default(true),
    excludeEventLocation: boolean().notNull().default(true),
    excludeEventName: boolean().notNull().default(true),
    excludeFocusTime: boolean().notNull().default(false),
    excludeOutOfOffice: boolean().notNull().default(false),
    includeInIcalFeed: boolean().notNull().default(false),
    treatFullDayTimedEventsAsAllDay: boolean().notNull().default(false),
    customEventName: text().notNull().default("{{calendar_name}}"),
    disabled: boolean().notNull().default(false),
    failureCount: integer().notNull().default(0),
    lastFailureAt: timestamp({ withTimezone: true }),
    nextAttemptAt: timestamp({ withTimezone: true }),
    ingestFailureCount: integer().notNull().default(0),
    ingestLastFailureAt: timestamp({ withTimezone: true }),
    ingestNextAttemptAt: timestamp({ withTimezone: true }),
    ingestFutureRange: text().notNull().default(DEFAULT_FUTURE_SYNC_RANGE),
    ingestHistoricRange: text().notNull().default(DEFAULT_HISTORIC_SYNC_RANGE),
    /*
     * When this calendar was last read from its provider without error. Distinct from
     * ingestWindowRecordedAt, which describes the coverage the reads asked for and is
     * deliberately rewritten only when that coverage moves — about once a day — so it
     * cannot say how old the stored copy of this calendar is. Two-way sync judges a real
     * source event against that stored copy before overwriting or deleting it, so it needs
     * an age it can bound. Null means unknown, which reads as too old.
     */
    ingestLastSucceededAt: timestamp({ withTimezone: true }),
    ingestWindowEnd: timestamp({ withTimezone: true }),
    ingestWindowRecordedAt: timestamp({ withTimezone: true }),
    ingestWindowStart: timestamp({ withTimezone: true }),
    externalCalendarId: text(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    capabilities: text().array().notNull().default(["pull"]),
    name: text().notNull(),
    originalName: text(),
    syncToken: text(),
    syncFutureRange: text().notNull().default(DEFAULT_FUTURE_SYNC_RANGE),
    syncHistoricRange: text().notNull().default(DEFAULT_HISTORIC_SYNC_RANGE),
    unavailableSince: timestamp({ withTimezone: true }),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    url: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("calendars_user_idx").on(table.userId),
    index("calendars_account_idx").on(table.accountId),
    index("calendars_capabilities_idx").on(table.capabilities),
    index("calendars_type_idx").on(table.calendarType),
    /*
     * Range columns are plain text so a bad write is only caught when a reader
     * asserts it, far from the writer that caused it. Constraining them here
     * keeps a corrupt persisted value distinguishable from a corrupt read.
     */
    check(
      "calendars_sync_ranges_check",
      sql`"syncHistoricRange" IN (${sql.raw(SYNC_RANGE_SQL_VALUES)}) AND "syncFutureRange" IN (${sql.raw(SYNC_RANGE_SQL_VALUES)})`,
    ),
    check(
      "calendars_ingest_coverage_check",
      sql`"ingestHistoricRange" IN (${sql.raw(SYNC_RANGE_SQL_VALUES)}) AND "ingestFutureRange" IN (${sql.raw(SYNC_RANGE_SQL_VALUES)}) AND (("ingestWindowStart" IS NULL AND "ingestWindowEnd" IS NULL AND "ingestWindowRecordedAt" IS NULL) OR ("ingestWindowStart" IS NOT NULL AND "ingestWindowEnd" IS NOT NULL AND "ingestWindowRecordedAt" IS NOT NULL AND "ingestWindowStart" < "ingestWindowEnd"))`,
    ),
  ],
);

const calendarPushChannelsTable = pgTable(
  "calendar_push_channels",
  {
    accountId: uuid()
      .notNull()
      .references(() => calendarAccountsTable.id, { onDelete: "cascade" }),
    calendarId: uuid().references(() => calendarsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }),
    failureCount: integer().notNull().default(0),
    id: uuid().notNull().primaryKey().defaultRandom(),
    lastFailureAt: timestamp({ withTimezone: true }),
    lastNotificationAt: timestamp({ withTimezone: true }),
    nextAttemptAt: timestamp({ withTimezone: true }),
    provider: text().notNull(),
    providerChannelId: text(),
    providerResourceId: text(),
    reauthorizeRequestedAt: timestamp({ withTimezone: true }),
    resourcePath: text(),
    secretHash: text().notNull(),
    state: text().notNull().default("registering"),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verifiedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("calendar_push_channels_account_idx").on(table.accountId),
    index("calendar_push_channels_expiry_idx").on(table.state, table.expiresAt),
    uniqueIndex("calendar_push_channels_provider_channel_idx")
      .on(table.provider, table.providerChannelId)
      .where(isNotNull(table.providerChannelId)),
    uniqueIndex("calendar_push_channels_scope_idx")
      .on(table.provider, table.calendarId)
      .where(sql`${table.calendarId} is not null and ${table.state} in ('registering', 'active', 'degraded')`),
  ],
);

const calendarSnapshotsTable = pgTable("calendar_snapshots", {
  calendarId: uuid()
    .notNull()
    .references(() => calendarsTable.id, { onDelete: "cascade" })
    .unique(),
  contentHash: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  ical: text().notNull(),
  id: uuid().notNull().primaryKey().defaultRandom(),
  public: boolean().notNull().default(false),
});

const eventStatesTable = pgTable(
  "event_states",
  {
    availability: text(),
    calendarId: uuid()
      .notNull()
      .references(() => calendarsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    description: text(),
    endTime: timestamp({ withTimezone: true }).notNull(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    location: text(),
    recurrenceRule: text(),
    exceptionDates: text(),
    recurrenceId: timestamp({ withTimezone: true }),
    isAllDay: boolean(),
    sourceEventId: text(),
    sourceEventType: text(),
    sourceEventUid: text(),
    startTime: timestamp({ withTimezone: true }).notNull(),
    startTimeZone: text(),
    title: text(),
  },
  (table) => [
    index("event_states_start_time_idx").on(table.startTime),
    index("event_states_end_time_idx").on(table.endTime),
    index("event_states_calendar_idx").on(table.calendarId),
    uniqueIndex("event_states_source_event_idx")
      .on(table.calendarId, table.sourceEventId)
      .where(isNotNull(table.sourceEventId)),
    uniqueIndex("event_states_recurring_instance_idx")
      .on(table.calendarId, table.sourceEventUid, table.recurrenceId)
      .where(sql`${table.sourceEventId} is null and ${table.recurrenceId} is not null`),
    uniqueIndex("event_states_non_recurring_instance_idx")
      .on(table.calendarId, table.sourceEventUid, table.startTime, table.endTime)
      .where(sql`${table.sourceEventId} is null and ${table.recurrenceId} is null`),
  ],
);

const userEventsTable = pgTable(
  "user_events",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    calendarId: uuid()
      .notNull()
      .references(() => calendarsTable.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceEventUid: text(),
    title: text(),
    description: text(),
    location: text(),
    availability: text(),
    isAllDay: boolean(),
    startTime: timestamp({ withTimezone: true }).notNull(),
    endTime: timestamp({ withTimezone: true }).notNull(),
    startTimeZone: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("user_events_user_idx").on(table.userId),
    index("user_events_calendar_idx").on(table.calendarId),
    index("user_events_start_time_idx").on(table.startTime),
    index("user_events_end_time_idx").on(table.endTime),
  ],
);

const userSubscriptionsTable = pgTable("user_subscriptions", {
  plan: text().notNull().default("free"),
  polarSubscriptionId: text(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  userId: text()
    .notNull()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
});

const syncStatusTable = pgTable(
  "sync_status",
  {
    calendarId: uuid()
      .notNull()
      .references(() => calendarsTable.id, { onDelete: "cascade" }),
    id: uuid().notNull().primaryKey().defaultRandom(),
    lastSyncedAt: timestamp({ withTimezone: true }),
    localEventCount: integer().notNull().default(DEFAULT_EVENT_COUNT),
    remoteEventCount: integer().notNull().default(DEFAULT_EVENT_COUNT),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("sync_status_calendar_idx").on(table.calendarId)],
);

const userSyncRequestsTable = pgTable("user_sync_requests", {
  requestId: uuid().notNull().defaultRandom(),
  requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  userId: text()
    .notNull()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
});

const eventMappingsTable = pgTable(
  "event_mappings",
  {
    calendarId: uuid()
      .notNull()
      .references(() => calendarsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deleteIdentifier: text(),
    /*
     * Nullable for rolling compatibility with writers from before these columns
     * existed. A null destinationContentHash reads as "unverified", so the next
     * observation records what the destination reported instead of acting on it.
     * The witness columns are always written together.
     */
    destinationAvailability: text(),
    destinationContentHash: text(),
    destinationDescription: text(),
    destinationEndTime: timestamp({ withTimezone: true }),
    destinationEventUid: text().notNull(),
    destinationIsAllDay: boolean(),
    destinationLocation: text(),
    destinationStartTime: timestamp({ withTimezone: true }),
    destinationSummary: text(),
    endTime: timestamp({ withTimezone: true }).notNull(),
    // Kept as the legacy cascade in Drizzle metadata so 0077 remains additive.
    // The migration runner upgrades the live FK to SET NULL before applying 0077.
    eventStateId: uuid()
      .references(() => eventStatesTable.id, { onDelete: "set null" }),
    id: uuid().notNull().primaryKey().defaultRandom(),
    missingFirstObservedAt: timestamp({ withTimezone: true }),
    missingObservationCount: integer().notNull().default(DEFAULT_EVENT_COUNT),
    syncEventId: text(),
    syncEventHash: text(),
    // Nullable for rolling compatibility with writers from before this column existed.
    // The migration runner backfills it and installs its validated index/checks.
    sourceCalendarId: uuid(),
    startTime: timestamp({ withTimezone: true }).notNull(),
    writeBackDailyCount: integer().notNull().default(DEFAULT_EVENT_COUNT),
    writeBackDailyWindowStart: timestamp({ withTimezone: true }),
    writeBackEpoch: integer().notNull().default(DEFAULT_EVENT_COUNT),
    writeBackEpochWindowStart: timestamp({ withTimezone: true }),
    /*
     * When this mapping last carried a write to its source. The runaway detector counts
     * write-backs that follow one another closely enough to be a machine rather than a
     * person, so it needs the gap between consecutive writes and not merely how many
     * happened in an hour.
     */
    writeBackLastAppliedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex("event_mappings_sync_event_cal_idx")
      .on(table.calendarId, table.syncEventId)
      .where(isNotNull(table.syncEventId)),
    index("event_mappings_calendar_idx").on(table.calendarId),
    index("event_mappings_event_state_idx").on(table.eventStateId),
    index("event_mappings_source_calendar_idx").on(table.sourceCalendarId),
    check(
      "event_mappings_identity_check",
      sql`${table.eventStateId} is not null or ${table.syncEventId} is not null`,
    ),
    index("event_mappings_missing_sync_event_idx")
      .on(table.id)
      .where(isNull(table.syncEventId)),
    index("event_mappings_sync_hash_idx").on(table.syncEventHash),
    index("event_mappings_pending_delete_idx")
      .on(table.calendarId, table.missingFirstObservedAt)
      .where(isNotNull(table.missingFirstObservedAt)),
  ],
);

const sourceDestinationMappingsTable = pgTable(
  "source_destination_mappings",
  {
    /*
     * The two observations "Delete the originals" is offered on. A read that returned
     * nothing at all cannot tell an emptied destination from a broken connection, so the
     * answer is withheld until a read has come back with at least one copy since the
     * copies were first found missing. Both are plain observations rather than derived
     * state, and both are per pair because that is where the question is asked and the
     * answer recorded. Nullable: every pair that exists today has neither, and a pair
     * with neither is not unlocked.
     */
    copiesMissingObservedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /*
     * The consent that lets deletions past the bulk breaker. Time bounded rather than a
     * flag some later pass has to clear, so a crash between the answer and the deletions
     * cannot leave the breaker disarmed.
     */
    deleteConfirmationApprovedAt: timestamp({ withTimezone: true }),
    lastHealthyReadAt: timestamp({ withTimezone: true }),
    destinationCalendarId: uuid()
      .notNull()
      .references(() => calendarsTable.id, { onDelete: "cascade" }),
    id: uuid().notNull().primaryKey().defaultRandom(),
    sourceCalendarId: uuid()
      .notNull()
      .references(() => calendarsTable.id, { onDelete: "cascade" }),
    writeBackEnabledAt: timestamp({ withTimezone: true }),
    writeBackMode: text().notNull().default(WRITE_BACK_MODE_OFF),
    writeBackState: text().notNull().default(WRITE_BACK_STATE_OK),
    writeBackStateReason: text(),
  },
  (table) => [
    uniqueIndex("source_destination_mapping_idx").on(
      table.sourceCalendarId,
      table.destinationCalendarId,
    ),
    index("source_destination_mappings_source_idx").on(table.sourceCalendarId),
    index("source_destination_mappings_destination_idx").on(table.destinationCalendarId),
    index("source_destination_mappings_write_back_idx")
      .on(table.writeBackMode)
      .where(sql`${table.writeBackMode} <> 'off'`),
  ],
);

const eventWriteBackTombstonesTable = pgTable(
  "event_write_back_tombstones",
  {
    appliedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /*
     * Deliberately unreferenced: a tombstone has to outlive the mapping, the
     * event state and the calendar whose deletion it records.
     */
    destinationCalendarId: uuid().notNull(),
    eventMappingId: uuid().notNull(),
    eventStateId: uuid(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    observedAt: timestamp({ withTimezone: true }),
    snapshot: jsonb().notNull(),
    sourceCalendarId: uuid().notNull(),
    sourceEventUid: text().notNull(),
    state: text().notNull(),
    /*
     * The one reference a tombstone does carry. Everything it records is the user's own
     * event text, so it cannot survive the account: deleting the account has to take the
     * snapshots with it, whatever the retention window still says.
     */
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("event_write_back_tombstones_source_idx").on(
      table.sourceCalendarId,
      table.appliedAt,
    ),
    index("event_write_back_tombstones_expiry_idx").on(table.expiresAt),
    index("event_write_back_tombstones_user_idx").on(table.userId),
    uniqueIndex("event_write_back_tombstones_mapping_idx").on(table.eventMappingId),
  ],
);

const feedbackTable = pgTable(
  "feedback",
  {
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    message: text().notNull(),
    type: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    wantsFollowUp: boolean().notNull().default(false),
  },
  (table) => [index("feedback_user_idx").on(table.userId)],
);

const apiTokensTable = pgTable(
  "api_tokens",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    tokenHash: text().notNull().unique(),
    tokenPrefix: text().notNull(),
    lastUsedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("api_tokens_user_idx").on(table.userId),
    uniqueIndex("api_tokens_hash_idx").on(table.tokenHash),
  ],
);

const icalFeedSettingsTable = pgTable("ical_feed_settings", {
  userId: text()
    .notNull()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  includeEventName: boolean().notNull().default(DEFAULT_FEED_SETTINGS.includeEventName),
  includeEventDescription: boolean()
    .notNull()
    .default(DEFAULT_FEED_SETTINGS.includeEventDescription),
  includeEventLocation: boolean().notNull().default(DEFAULT_FEED_SETTINGS.includeEventLocation),
  excludeAllDayEvents: boolean().notNull().default(DEFAULT_FEED_SETTINGS.excludeAllDayEvents),
  customEventName: text().notNull().default(DEFAULT_FEED_SETTINGS.customEventName),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

const icalFeedsTable = pgTable(
  "ical_feeds",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull().default(DEFAULT_FEED_NAME),
    token: text().notNull(),
    isDefault: boolean().notNull().default(false),
    legacyAlias: boolean().notNull().default(false),
    includeEventName: boolean().notNull().default(DEFAULT_FEED_SETTINGS.includeEventName),
    includeEventDescription: boolean()
      .notNull()
      .default(DEFAULT_FEED_SETTINGS.includeEventDescription),
    includeEventLocation: boolean().notNull().default(DEFAULT_FEED_SETTINGS.includeEventLocation),
    excludeAllDayEvents: boolean().notNull().default(DEFAULT_FEED_SETTINGS.excludeAllDayEvents),
    excludeFocusTime: boolean().notNull().default(DEFAULT_FEED_SETTINGS.excludeFocusTime),
    excludeOutOfOffice: boolean().notNull().default(DEFAULT_FEED_SETTINGS.excludeOutOfOffice),
    customEventName: text().notNull().default(DEFAULT_FEED_SETTINGS.customEventName),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("ical_feeds_user_idx").on(table.userId),
    uniqueIndex("ical_feeds_token_idx").on(table.token),
    uniqueIndex("ical_feeds_default_idx")
      .on(table.userId)
      .where(eq(table.isDefault, sql`true`)),
  ],
);

const icalFeedCalendarsTable = pgTable(
  "ical_feed_calendars",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    feedId: uuid()
      .notNull()
      .references(() => icalFeedsTable.id, { onDelete: "cascade" }),
    calendarId: uuid()
      .notNull()
      .references(() => calendarsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ical_feed_calendar_idx").on(table.feedId, table.calendarId),
    index("ical_feed_calendars_feed_idx").on(table.feedId),
    index("ical_feed_calendars_calendar_idx").on(table.calendarId),
  ],
);

export {
  apiTokensTable,
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarPushChannelsTable,
  calendarSnapshotsTable,
  calendarsTable,
  eventMappingsTable,
  eventStatesTable,
  eventWriteBackTombstonesTable,
  feedbackTable,
  icalFeedCalendarsTable,
  icalFeedSettingsTable,
  icalFeedsTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
  syncStatusTable,
  userSyncRequestsTable,
  userEventsTable,
  userSubscriptionsTable,
};
