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

const oauthCredentialsTable = pgTable("oauth_credentials", {
  accessToken: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  expiresAt: timestamp().notNull(),
  id: uuid().notNull().primaryKey().defaultRandom(),
  refreshToken: text().notNull(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

const oauthSourceCredentialsTable = pgTable(
  "oauth_source_credentials",
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
    index("oauth_source_credentials_user_idx").on(table.userId),
    index("oauth_source_credentials_provider_idx").on(table.provider),
  ],
);

const caldavCredentialsTable = pgTable("caldav_credentials", {
  calendarUrl: text().notNull(),
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

const caldavSourceCredentialsTable = pgTable("caldav_source_credentials", {
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

const calendarSourcesTable = pgTable(
  "calendar_sources",
  {
    caldavCredentialId: uuid().references(() => caldavSourceCredentialsTable.id, {
      onDelete: "set null",
    }),
    calendarUrl: text(),
    createdAt: timestamp().notNull().defaultNow(),
    externalCalendarId: text(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    name: text().notNull(),
    oauthCredentialId: uuid().references(() => oauthSourceCredentialsTable.id, {
      onDelete: "set null",
    }),
    provider: text(),
    sourceType: text().notNull(),
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
    index("calendar_sources_user_idx").on(table.userId),
    index("calendar_sources_type_idx").on(table.sourceType),
    index("calendar_sources_provider_idx").on(table.provider),
  ],
);

const calendarSnapshotsTable = pgTable("calendar_snapshots", {
  contentHash: text(),
  createdAt: timestamp().notNull().defaultNow(),
  ical: text().notNull(),
  id: uuid().notNull().primaryKey().defaultRandom(),
  public: boolean().notNull().default(false),
  sourceId: uuid()
    .notNull()
    .references(() => calendarSourcesTable.id, { onDelete: "cascade" }),
});

const eventStatesTable = pgTable(
  "event_states",
  {
    createdAt: timestamp().notNull().defaultNow(),
    endTime: timestamp().notNull(),
    id: uuid().notNull().primaryKey().defaultRandom(),
    sourceEventUid: text(),
    sourceId: uuid()
      .notNull()
      .references(() => calendarSourcesTable.id, { onDelete: "cascade" }),
    startTime: timestamp().notNull(),
  },
  (table) => [
    index("event_states_start_time_idx").on(table.startTime),
    index("event_states_source_idx").on(table.sourceId),
    uniqueIndex("event_states_identity_idx").on(
      table.sourceId,
      table.sourceEventUid,
      table.startTime,
      table.endTime,
    ),
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

const calendarDestinationsTable = pgTable(
  "calendar_destinations",
  {
    accountId: text().notNull(),
    caldavCredentialId: uuid().references(() => caldavCredentialsTable.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp().notNull().defaultNow(),
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
    uniqueIndex("calendar_destinations_provider_account_idx").on(table.provider, table.accountId),
  ],
);

const syncStatusTable = pgTable(
  "sync_status",
  {
    destinationId: uuid()
      .notNull()
      .references(() => calendarDestinationsTable.id, { onDelete: "cascade" }),
    id: uuid().notNull().primaryKey().defaultRandom(),
    lastSyncedAt: timestamp(),
    localEventCount: integer().notNull().default(DEFAULT_EVENT_COUNT),
    remoteEventCount: integer().notNull().default(DEFAULT_EVENT_COUNT),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("sync_status_destination_idx").on(table.destinationId)],
);

const eventMappingsTable = pgTable(
  "event_mappings",
  {
    createdAt: timestamp().notNull().defaultNow(),
    deleteIdentifier: text(),
    destinationEventUid: text().notNull(),
    destinationId: uuid()
      .notNull()
      .references(() => calendarDestinationsTable.id, { onDelete: "cascade" }),
    endTime: timestamp().notNull(),
    eventStateId: uuid()
      .notNull()
      .references(() => eventStatesTable.id, { onDelete: "cascade" }),
    id: uuid().notNull().primaryKey().defaultRandom(),
    startTime: timestamp().notNull(),
  },
  (table) => [
    uniqueIndex("event_mappings_event_dest_idx").on(table.eventStateId, table.destinationId),
    index("event_mappings_destination_idx").on(table.destinationId),
  ],
);

const sourceDestinationMappingsTable = pgTable(
  "source_destination_mappings",
  {
    createdAt: timestamp().notNull().defaultNow(),
    destinationId: uuid()
      .notNull()
      .references(() => calendarDestinationsTable.id, { onDelete: "cascade" }),
    id: uuid().notNull().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      .references(() => calendarSourcesTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("source_destination_mapping_idx").on(table.sourceId, table.destinationId),
    index("source_destination_mappings_source_idx").on(table.sourceId),
    index("source_destination_mappings_destination_idx").on(table.destinationId),
  ],
);

export {
  caldavCredentialsTable,
  caldavSourceCredentialsTable,
  calendarDestinationsTable,
  calendarSnapshotsTable,
  calendarSourcesTable,
  eventMappingsTable,
  eventStatesTable,
  oauthCredentialsTable,
  oauthSourceCredentialsTable,
  sourceDestinationMappingsTable,
  syncStatusTable,
  userSubscriptionsTable,
};
