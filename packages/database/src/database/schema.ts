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

const remoteICalSourcesTable = pgTable("remote_ical_sources", {
  createdAt: timestamp().notNull().defaultNow(),
  id: uuid().notNull().primaryKey().defaultRandom(),
  name: text().notNull(),
  url: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

const calendarSnapshotsTable = pgTable("calendar_snapshots", {
  contentHash: text(),
  createdAt: timestamp().notNull().defaultNow(),
  ical: text().notNull(),
  id: uuid().notNull().primaryKey().defaultRandom(),
  public: boolean().notNull().default(false),
  sourceId: uuid()
    .notNull()
    .references(() => remoteICalSourcesTable.id, { onDelete: "cascade" }),
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
      .references(() => remoteICalSourcesTable.id, { onDelete: "cascade" }),
    startTime: timestamp().notNull(),
  },
  (table) => [
    index("event_states_start_time_idx").on(table.startTime),
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
      .references(() => remoteICalSourcesTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("source_destination_mapping_idx").on(table.sourceId, table.destinationId),
    index("source_destination_mappings_source_idx").on(table.sourceId),
    index("source_destination_mappings_destination_idx").on(table.destinationId),
  ],
);

export {
  remoteICalSourcesTable,
  calendarSnapshotsTable,
  eventStatesTable,
  userSubscriptionsTable,
  oauthCredentialsTable,
  caldavCredentialsTable,
  calendarDestinationsTable,
  syncStatusTable,
  eventMappingsTable,
  sourceDestinationMappingsTable,
};
