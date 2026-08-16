import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createDatabaseWriteBackStore } from "../src/write-back";
import type { SourceEventSnapshot, WriteBackTarget } from "../src/write-back-pass";

const client = new PGlite();
const database = drizzle(client);

const USER_ID = "user-id";
const SOURCE_CALENDAR_ID = "11111111-1111-4111-8111-111111111111";
const DESTINATION_CALENDAR_ID = "22222222-2222-4222-8222-222222222222";
const MAPPING_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_STATE_ID = "44444444-4444-4444-8444-444444444444";

const DDL = `
create table event_write_back_tombstones (
  "id" uuid primary key default gen_random_uuid(),
  "appliedAt" timestamptz not null default now(),
  "destinationCalendarId" uuid not null,
  "eventMappingId" uuid not null,
  "eventStateId" uuid,
  "expiresAt" timestamptz not null,
  "observedAt" timestamptz,
  "snapshot" jsonb not null,
  "sourceCalendarId" uuid not null,
  "sourceEventUid" text not null,
  "state" text not null,
  "userId" text not null
);
create unique index event_write_back_tombstones_mapping_idx
  on event_write_back_tombstones ("eventMappingId");
`;

const SNAPSHOT: SourceEventSnapshot = {
  description: "Bring the notes",
  endTime: new Date("2027-05-11T15:00:00.000Z"),
  isAllDay: null,
  location: "Room 4",
  startTime: new Date("2027-05-11T14:00:00.000Z"),
  startTimeZone: "America/Toronto",
  title: "Quarterly review",
};

const target: WriteBackTarget = {
  deleteIdentifier: "destination-delete-id-1",
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  destinationEventUid: "destination-uid-1",
  eventStateId: EVENT_STATE_ID,
  mappingId: MAPPING_ID,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  sourceEventId: null,
  sourceEventUid: "source-event-uid-1",
};

const store = createDatabaseWriteBackStore({
  database: database as unknown as BunSQLDatabase,
  encryptionKey: "encryption-key",
  oauthConfig: {},
  userId: USER_ID,
});

const readState = async (): Promise<string> => {
  const rows = await client.query<{ state: string }>(
    `select "state" from event_write_back_tombstones where "eventMappingId" = $1`,
    [MAPPING_ID],
  );
  return rows.rows[0]?.state ?? "missing";
};

const markApplied = async (): Promise<void> => {
  await client.query(
    `update event_write_back_tombstones set "state" = 'applied' where "eventMappingId" = $1`,
    [MAPPING_ID],
  );
};

const recordTombstone = () => store.recordTombstone({ snapshot: SNAPSHOT, target });

describe("a completed deletion is never un-recorded by a losing pass", () => {
  beforeAll(async () => {
    await client.exec(DDL);
  });

  beforeEach(async () => {
    await client.exec("delete from event_write_back_tombstones");
  });

  it("keeps the applied record when a losing pass releases the shared row", async () => {
    const { id, observedAt } = await recordTombstone();
    await markApplied();

    await store.abandonTombstone({ observedAt, tombstoneId: id });

    expect(await readState()).toBe("applied");
  });

  it("still counts a completed deletion toward the daily cap after a release", async () => {
    const { id, observedAt } = await recordTombstone();
    await markApplied();
    await store.abandonTombstone({ observedAt, tombstoneId: id });

    const total = await store.countRecentDeletes(
      SOURCE_CALENDAR_ID,
      new Date("2000-01-01T00:00:00.000Z"),
    );

    expect(total).toBe(1);
  });

  it("refuses to return an applied record to pending when a losing pass records it", async () => {
    await recordTombstone();
    await markApplied();

    const second = await recordTombstone();

    expect(second.priorAttempt).toBe(true);
    expect(await readState()).toBe("applied");
  });

  it("still lets a genuinely abandoned record be retried", async () => {
    const { id, observedAt } = await recordTombstone();
    await store.abandonTombstone({ observedAt, tombstoneId: id });

    const retry = await recordTombstone();

    expect(retry.priorAttempt).toBe(false);
    expect(await readState()).toBe("pending");
  });

  it("refuses a release from the pass whose record another has since replaced", async () => {
    const first = await recordTombstone();
    await recordTombstone();

    await store.abandonTombstone({
      observedAt: first.observedAt,
      tombstoneId: first.id,
    });

    expect(await readState()).toBe("pending");
  });

  it("holds a record left pending by an interrupted attempt", async () => {
    await recordTombstone();

    const retry = await recordTombstone();

    expect(retry.priorAttempt).toBe(true);
    expect(await readState()).toBe("pending");
  });
});
