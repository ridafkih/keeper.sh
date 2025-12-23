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
    startTime: timestamp().notNull(),
    endTime: timestamp().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (table) => [index("event_states_start_time_idx").on(table.startTime)],
);

export const userSubscriptionsTable = pgTable("user_subscriptions", {
  userId: text()
    .notNull()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  plan: text().notNull().default("free"),
  polarSubscriptionId: text(),
  updatedAt: timestamp().notNull().defaultNow(),
});

export const syncStatusTable = pgTable(
  "sync_status",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    localEventCount: integer().notNull().default(0),
    remoteEventCount: integer().notNull().default(0),
    lastSyncedAt: timestamp(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sync_status_user_provider_idx").on(table.userId, table.provider),
  ],
);

