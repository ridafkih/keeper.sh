import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DELETION_RECORD_LIMIT,
  listWriteBackDeletions,
} from "../../src/queries/list-write-back-deletions";
import type { KeeperDatabase } from "../../src/types";

const client = new PGlite();
const database = drizzle(client) as unknown as KeeperDatabase;

const OWNER_ID = "user-1";
const NOW = new Date("2026-08-15T12:00:00.000Z");
const RECORDED = 501;

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

const insertCalendar = async (name: string): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `insert into calendars ("name", "userId") values ($1, $2) returning "id"`,
    [name, OWNER_ID],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to seed a calendar");
  }
  return id;
};

/*
 * Both consent surfaces promise a record of EVERY original Keeper.sh deletes, kept for 30
 * days, and the deletion cap allows 50 a day per source calendar — a handful of two-way
 * connections passes 500 inside the window without anything going wrong. The query stops at
 * DELETION_RECORD_LIMIT and neither the response nor the page carries any sign that it did,
 * so the oldest deletions leave the record early and read as deletions that never happened.
 */
describe("the record of deleted originals past the query's ceiling", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendars; drop table if exists event_write_back_tombstones;`,
    );
    await client.exec(DDL);
  });

  it("keeps every deletion inside the retention window reachable", async () => {
    const source = await insertCalendar("Personal");
    const destination = await insertCalendar("Work");
    for (let index = 0; index < RECORDED; index += 1) {
      const appliedAt = new Date(NOW.getTime() - (index * 60_000)).toISOString();
      await client.query(
        `insert into event_write_back_tombstones
           ("appliedAt", "destinationCalendarId", "eventMappingId", "expiresAt", "snapshot",
            "sourceCalendarId", "sourceEventUid", "state", "userId")
         values ($1, $2, gen_random_uuid(), $3, $4, $5, $6, 'applied', $7)`,
        [
          appliedAt,
          destination,
          "2026-09-13T09:00:00.000Z",
          JSON.stringify({ title: `Deleted ${index}` }),
          source,
          `uid-${index}`,
          OWNER_ID,
        ],
      );
    }

    const { deletions, truncated } = await listWriteBackDeletions(database, OWNER_ID, NOW);

    expect(deletions).toHaveLength(RECORDED);
    expect(truncated).toBe(false);
  });

  it("says so when it did have to stop, rather than ending the list silently", async () => {
    const source = await insertCalendar("Personal");
    const destination = await insertCalendar("Work");
    await client.query(
      `insert into event_write_back_tombstones
         ("appliedAt", "destinationCalendarId", "eventMappingId", "expiresAt", "snapshot",
          "sourceCalendarId", "sourceEventUid", "state", "userId")
       select $1::timestamp - (index * interval '1 minute'), $2, gen_random_uuid(), $3,
              jsonb_build_object('title', 'Deleted ' || index), $4, 'uid-' || index,
              'applied', $5
       from generate_series(0, $6::int) as index`,
      [
        NOW.toISOString(),
        destination,
        "2026-09-13T09:00:00.000Z",
        source,
        OWNER_ID,
        DELETION_RECORD_LIMIT,
      ],
    );

    const { deletions, truncated } = await listWriteBackDeletions(database, OWNER_ID, NOW);

    expect(deletions).toHaveLength(DELETION_RECORD_LIMIT);
    expect(truncated).toBe(true);
  });
});
