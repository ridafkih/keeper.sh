import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

const DEFAULT_EVENT_COUNT = 0;

const oauthCredentialsTable = pgTable(
  "oauth_credentials",
  {
    accessToken: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    email: text(),
    expiresAt: timestamp().notNull(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    needsReauthentication: boolean().notNull().default(false),
    provider: text().notNull(),
    refreshToken: text().notNull(),
    updatedAt: timestamp()
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
  createdAt: timestamp().notNull().defaultNow(),
  encryptedPassword: text().notNull(),
  id: uuid().notNull().primaryKey().defaultRandom(),
  serverUrl: text().notNull(),
  updatedAt: timestamp()
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
    createdAt: timestamp().notNull().defaultNow(),
    displayName: text(),
    email: text(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    needsReauthentication: boolean().notNull().default(false),
    oauthCredentialId: uuid().references(() => oauthCredentialsTable.id, {
      onDelete: "cascade",
    }),
    provider: text().notNull(),
    updatedAt: timestamp()
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
    createdAt: timestamp().notNull().defaultNow(),
    excludeAllDayEvents: boolean().notNull().default(false),
    excludeEventDescription: boolean().notNull().default(false),
    excludeEventLocation: boolean().notNull().default(false),
    excludeEventName: boolean().notNull().default(false),
    excludeFocusTime: boolean().notNull().default(false),
    excludeOutOfOffice: boolean().notNull().default(false),
    excludeWorkingLocation: boolean().notNull().default(false),
    includeInIcalFeed: boolean().notNull().default(false),
    customEventName: text().notNull().default(""),
    disabled: boolean().notNull().default(false),
    externalCalendarId: text(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    capabilities: text().array().notNull().default(["pull"]),
    name: text().notNull(),
    originalName: text(),
    syncToken: text(),
    updatedAt: timestamp()
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
  ],
);

const calendarSnapshotsTable = pgTable("calendar_snapshots", {
  calendarId: uuid()
    .notNull()
    .references(() => calendarsTable.id, { onDelete: "cascade" })
    .unique(),
  contentHash: text(),
  createdAt: timestamp().notNull().defaultNow(),
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
    createdAt: timestamp().notNull().defaultNow(),
    description: text(),
    endTime: timestamp().notNull(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    location: text(),
    recurrenceRule: text(),
    exceptionDates: text(),
    isAllDay: boolean(),
    sourceEventType: text(),
    sourceEventUid: text(),
    startTime: timestamp().notNull(),
    startTimeZone: text(),
    title: text(),
  },
  (table) => [
    index("event_states_start_time_idx").on(table.startTime),
    index("event_states_end_time_idx").on(table.endTime),
    index("event_states_calendar_idx").on(table.calendarId),
    uniqueIndex("event_states_identity_idx").on(
      table.calendarId,
      table.sourceEventUid,
      table.startTime,
      table.endTime,
    ),
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
    startTime: timestamp().notNull(),
    endTime: timestamp().notNull(),
    startTimeZone: text(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp()
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
  updatedAt: timestamp()
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
    lastSyncedAt: timestamp(),
    localEventCount: integer().notNull().default(DEFAULT_EVENT_COUNT),
    remoteEventCount: integer().notNull().default(DEFAULT_EVENT_COUNT),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("sync_status_calendar_idx").on(table.calendarId)],
);

const eventMappingsTable = pgTable(
  "event_mappings",
  {
    calendarId: uuid()
      .notNull()
      .references(() => calendarsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp().notNull().defaultNow(),
    deleteIdentifier: text(),
    destinationEventUid: text().notNull(),
    endTime: timestamp().notNull(),
    eventStateId: uuid()
      .notNull()
      .references(() => eventStatesTable.id, { onDelete: "cascade" }),
    id: uuid().notNull().primaryKey().defaultRandom(),
    syncEventHash: text(),
    startTime: timestamp().notNull(),
  },
  (table) => [
    uniqueIndex("event_mappings_event_cal_idx").on(table.eventStateId, table.calendarId),
    index("event_mappings_calendar_idx").on(table.calendarId),
    index("event_mappings_sync_hash_idx").on(table.syncEventHash),
  ],
);

const sourceDestinationMappingsTable = pgTable(
  "source_destination_mappings",
  {
    createdAt: timestamp().notNull().defaultNow(),
    destinationCalendarId: uuid()
      .notNull()
      .references(() => calendarsTable.id, { onDelete: "cascade" }),
    id: uuid().notNull().primaryKey().defaultRandom(),
    sourceCalendarId: uuid()
      .notNull()
      .references(() => calendarsTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("source_destination_mapping_idx").on(
      table.sourceCalendarId,
      table.destinationCalendarId,
    ),
    index("source_destination_mappings_source_idx").on(table.sourceCalendarId),
    index("source_destination_mappings_destination_idx").on(table.destinationCalendarId),
  ],
);

const feedbackTable = pgTable(
  "feedback",
  {
    createdAt: timestamp().notNull().defaultNow(),
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
    lastUsedAt: timestamp(),
    expiresAt: timestamp(),
    createdAt: timestamp().notNull().defaultNow(),
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
  includeEventName: boolean().notNull().default(false),
  includeEventDescription: boolean().notNull().default(false),
  includeEventLocation: boolean().notNull().default(false),
  excludeAllDayEvents: boolean().notNull().default(false),
  customEventName: text().notNull().default("Busy"),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export {
  apiTokensTable,
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarSnapshotsTable,
  calendarsTable,
  eventMappingsTable,
  eventStatesTable,
  feedbackTable,
  icalFeedSettingsTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
  syncStatusTable,
  userEventsTable,
  userSubscriptionsTable,
};
