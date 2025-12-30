import {
  boolean,
  integer,
  text,
  pgTable,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const remoteICalSourcesTable = pgTable("remote_ical_sources", {
  id: uuid().notNull().primaryKey().defaultRandom(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text().notNull(),
  url: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
});

export const calendarSnapshotsTable = pgTable("calendar_snapshots", {
  id: uuid().notNull().primaryKey().defaultRandom(),
  sourceId: uuid()
    .notNull()
    .references(() => remoteICalSourcesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp().notNull().defaultNow(),
  ical: text().notNull(),
  public: boolean().notNull().default(false),
});

export const eventStatesTable = pgTable(
  "event_states",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      .references(() => remoteICalSourcesTable.id, { onDelete: "cascade" }),
    sourceEventUid: text(),
    startTime: timestamp().notNull(),
    endTime: timestamp().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
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

export const userSubscriptionsTable = pgTable("user_subscriptions", {
  userId: text()
    .notNull()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  plan: text().notNull().default("free"),
  polarSubscriptionId: text(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
});

export const oauthCredentialsTable = pgTable("oauth_credentials", {
  id: uuid().notNull().primaryKey().defaultRandom(),
  accessToken: text().notNull(),
  refreshToken: text().notNull(),
  expiresAt: timestamp().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
});

export const caldavCredentialsTable = pgTable("caldav_credentials", {
  id: uuid().notNull().primaryKey().defaultRandom(),
  serverUrl: text().notNull(),
  calendarUrl: text().notNull(),
  username: text().notNull(),
  encryptedPassword: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
});

export const calendarDestinationsTable = pgTable(
  "calendar_destinations",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    accountId: text().notNull(),
    email: text(),
    oauthCredentialId: uuid().references(() => oauthCredentialsTable.id, {
      onDelete: "cascade",
    }),
    caldavCredentialId: uuid().references(() => caldavCredentialsTable.id, {
      onDelete: "cascade",
    }),
    needsReauthentication: boolean().notNull().default(false),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("calendar_destinations_provider_account_idx").on(
      table.provider,
      table.accountId,
    ),
  ],
);

export const syncStatusTable = pgTable(
  "sync_status",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    destinationId: uuid()
      .notNull()
      .references(() => calendarDestinationsTable.id, { onDelete: "cascade" }),
    localEventCount: integer().notNull().default(0),
    remoteEventCount: integer().notNull().default(0),
    lastSyncedAt: timestamp(),
    updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("sync_status_destination_idx").on(table.destinationId),
  ],
);

export const eventMappingsTable = pgTable(
  "event_mappings",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    eventStateId: uuid()
      .notNull()
      .references(() => eventStatesTable.id, { onDelete: "cascade" }),
    destinationId: uuid()
      .notNull()
      .references(() => calendarDestinationsTable.id, { onDelete: "cascade" }),
    destinationEventUid: text().notNull(),
    deleteIdentifier: text(),
    startTime: timestamp().notNull(),
    endTime: timestamp().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("event_mappings_event_dest_idx").on(
      table.eventStateId,
      table.destinationId,
    ),
    index("event_mappings_destination_idx").on(table.destinationId),
  ],
);
