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

// --- Unified credential tables ---

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

// --- Calendar accounts (linked account concept) ---

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
  ],
);

// --- Unified calendars table (replaces calendar_sources + calendar_destinations) ---

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
    customEventName: text().notNull().default(""),
    externalCalendarId: text(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    capabilities: text().array().notNull().default(["pull"]),
    name: text().notNull(),
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

// --- Snapshots ---

const calendarSnapshotsTable = pgTable("calendar_snapshots", {
  calendarId: uuid()
    .notNull()
    .references(() => calendarsTable.id, { onDelete: "cascade" }),
  contentHash: text(),
  createdAt: timestamp().notNull().defaultNow(),
  ical: text().notNull(),
  id: uuid().notNull().primaryKey().defaultRandom(),
  public: boolean().notNull().default(false),
});

// --- Event states ---

const eventStatesTable = pgTable(
  "event_states",
  {
    calendarId: uuid()
      .notNull()
      .references(() => calendarsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp().notNull().defaultNow(),
    description: text(),
    endTime: timestamp().notNull(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    location: text(),
    sourceEventUid: text(),
    startTime: timestamp().notNull(),
    title: text(),
  },
  (table) => [
    index("event_states_start_time_idx").on(table.startTime),
    index("event_states_calendar_idx").on(table.calendarId),
    uniqueIndex("event_states_identity_idx").on(
      table.calendarId,
      table.sourceEventUid,
      table.startTime,
      table.endTime,
    ),
  ],
);

// --- User subscriptions ---

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

// --- Sync status ---

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

// --- Event mappings ---

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
    startTime: timestamp().notNull(),
  },
  (table) => [
    uniqueIndex("event_mappings_event_cal_idx").on(table.eventStateId, table.calendarId),
    index("event_mappings_calendar_idx").on(table.calendarId),
  ],
);

// --- Source-destination calendar mappings ---

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

export {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarSnapshotsTable,
  calendarsTable,
  eventMappingsTable,
  eventStatesTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
  syncStatusTable,
  userSubscriptionsTable,
};
