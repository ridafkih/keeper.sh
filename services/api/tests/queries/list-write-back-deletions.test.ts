import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { listWriteBackDeletions } from "../../src/queries/list-write-back-deletions";
import type { KeeperDatabase } from "../../src/types";

const client = new PGlite();
const database = drizzle(client) as unknown as KeeperDatabase;

const OWNER_ID = "user-1";
const STRANGER_ID = "user-2";
const NOW = new Date("2026-08-15T12:00:00.000Z");

const DDL = `
create table calendars (
  "id" uuid primary key default gen_random_uuid(),
  "name" text not null,
  "userId" text not null
);
create table event_write_back_tombstones (
  "id" uuid primary key default gen_random_uuid(),
  "appliedAt" timestamp not null default now(),
  "destinationCalendarId" uuid not null,
  "eventMappingId" uuid not null,
  "eventStateId" uuid,
  "expiresAt" timestamp not null,
  "observedAt" timestamp,
  "snapshot" jsonb not null,
  "sourceCalendarId" uuid not null,
  "sourceEventUid" text not null,
  "state" text not null,
  "userId" text not null
);
`;

const SNAPSHOT = {
  description: "Bring the slides",
  endTime: "2026-08-01T10:30:00.000Z",
  isAllDay: false,
  location: "Room 2",
  startTime: "2026-08-01T10:00:00.000Z",
  startTimeZone: "Europe/London",
  title: "Standup",
};

const insertCalendar = async (name: string, userId: string): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `insert into calendars ("name", "userId") values ($1, $2) returning "id"`,
    [name, userId],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to seed a calendar");
  }
  return id;
};

const insertTombstone = async (input: {
  appliedAt?: string;
  destinationCalendarId: string;
  expiresAt?: string;
  snapshot?: unknown;
  sourceCalendarId: string;
  state: string;
  userId: string;
}): Promise<void> => {
  await client.query(
    `insert into event_write_back_tombstones
       ("appliedAt", "destinationCalendarId", "eventMappingId", "expiresAt", "snapshot",
        "sourceCalendarId", "sourceEventUid", "state", "userId")
     values ($1, $2, gen_random_uuid(), $3, $4, $5, 'uid-1', $6, $7)`,
    [
      input.appliedAt ?? "2026-08-14T09:00:00.000Z",
      input.destinationCalendarId,
      input.expiresAt ?? "2026-09-13T09:00:00.000Z",
      JSON.stringify(input.snapshot ?? SNAPSHOT),
      input.sourceCalendarId,
      input.state,
      input.userId,
    ],
  );
};

/*
 * The record exists so somebody who deleted a copy by mistake can see what Keeper.sh
 * destroyed on their behalf. Every predicate here is part of that promise: their own
 * deletions and nobody else's, a deletion that was abandoned left out because the original
 * is still there, and nothing past the retention window the copy advertises.
 */
describe("the record of originals write-back deleted", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists calendars; drop table if exists event_write_back_tombstones;`);
    await client.exec(DDL);
  });

  it("returns the deleted event as it was, named against both calendars", async () => {
    const source = await insertCalendar("Personal", OWNER_ID);
    const destination = await insertCalendar("Work", OWNER_ID);
    await insertTombstone({
      destinationCalendarId: destination,
      sourceCalendarId: source,
      state: "applied",
      userId: OWNER_ID,
    });

    const { deletions } = await listWriteBackDeletions(database, OWNER_ID, NOW);
    const [deletion] = deletions;

    expect(deletion).toMatchObject({
      confirmed: true,
      description: "Bring the slides",
      destinationCalendarName: "Work",
      endTime: "2026-08-01T10:30:00.000Z",
      location: "Room 2",
      sourceCalendarName: "Personal",
      startTime: "2026-08-01T10:00:00.000Z",
      title: "Standup",
    });
  });

  it("never shows one user the events deleted from another user's calendar", async () => {
    const source = await insertCalendar("Theirs", STRANGER_ID);
    const destination = await insertCalendar("Theirs too", STRANGER_ID);
    await insertTombstone({
      destinationCalendarId: destination,
      sourceCalendarId: source,
      state: "applied",
      userId: STRANGER_ID,
    });

    const { deletions } = await listWriteBackDeletions(database, OWNER_ID, NOW);

    expect(deletions).toEqual([]);
  });

  it("leaves out a deletion that was abandoned, because that original is still there", async () => {
    const source = await insertCalendar("Personal", OWNER_ID);
    const destination = await insertCalendar("Work", OWNER_ID);
    await insertTombstone({
      destinationCalendarId: destination,
      sourceCalendarId: source,
      state: "abandoned",
      userId: OWNER_ID,
    });

    const { deletions } = await listWriteBackDeletions(database, OWNER_ID, NOW);

    expect(deletions).toEqual([]);
  });

  it("lists a deletion nothing has confirmed, marked as unconfirmed", async () => {
    const source = await insertCalendar("Personal", OWNER_ID);
    const destination = await insertCalendar("Work", OWNER_ID);
    await insertTombstone({
      destinationCalendarId: destination,
      sourceCalendarId: source,
      state: "pending",
      userId: OWNER_ID,
    });

    const { deletions } = await listWriteBackDeletions(database, OWNER_ID, NOW);

    expect(deletions).toHaveLength(1);
    expect(deletions[0]?.confirmed).toBe(false);
  });

  it("drops a record whose retention window has run out", async () => {
    const source = await insertCalendar("Personal", OWNER_ID);
    const destination = await insertCalendar("Work", OWNER_ID);
    await insertTombstone({
      destinationCalendarId: destination,
      expiresAt: "2026-08-15T11:00:00.000Z",
      sourceCalendarId: source,
      state: "applied",
      userId: OWNER_ID,
    });

    const { deletions } = await listWriteBackDeletions(database, OWNER_ID, NOW);

    expect(deletions).toEqual([]);
  });

  it("still names the deletion after the calendar it came from is gone", async () => {
    const source = await insertCalendar("Personal", OWNER_ID);
    const destination = await insertCalendar("Work", OWNER_ID);
    await insertTombstone({
      destinationCalendarId: destination,
      sourceCalendarId: source,
      state: "applied",
      userId: OWNER_ID,
    });
    await client.query(`delete from calendars where "id" = $1`, [source]);

    const { deletions } = await listWriteBackDeletions(database, OWNER_ID, NOW);
    const [deletion] = deletions;

    expect(deletion).toMatchObject({ sourceCalendarName: null, title: "Standup" });
  });

  it("puts the most recent deletion first", async () => {
    const source = await insertCalendar("Personal", OWNER_ID);
    const destination = await insertCalendar("Work", OWNER_ID);
    await insertTombstone({
      appliedAt: "2026-08-10T09:00:00.000Z",
      destinationCalendarId: destination,
      snapshot: { ...SNAPSHOT, title: "Older" },
      sourceCalendarId: source,
      state: "applied",
      userId: OWNER_ID,
    });
    await insertTombstone({
      appliedAt: "2026-08-14T09:00:00.000Z",
      destinationCalendarId: destination,
      snapshot: { ...SNAPSHOT, title: "Newer" },
      sourceCalendarId: source,
      state: "applied",
      userId: OWNER_ID,
    });

    const { deletions } = await listWriteBackDeletions(database, OWNER_ID, NOW);

    expect(deletions.map((deletion) => deletion.title)).toEqual(["Newer", "Older"]);
  });
});
