import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseWriteBackStore } from "../src/write-back";
import type { WriteBackApplierConfig } from "../src/write-back";
import { runWriteBackPass } from "../src/write-back-pass";
import type { WriteBackPassResult } from "../src/write-back-pass";

/*
 * A delete that turns back inside the source lock releases its record through
 * config.database while the lock's own transaction is still open, so one write-back
 * delete occupies two pool connections at once. The pool is the bound on how many sync
 * jobs can be in flight, so the pass that needs a second connection to finish is waiting
 * on connections the other passes cannot give back until they finish.
 */
const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const POOL_CONNECTIONS = 2;
const CONCURRENT_PASSES = 2;
const PASS_DEADLINE_MS = 10_000;

const DDL = `
drop table if exists event_write_back_tombstones cascade;
drop table if exists event_mappings cascade;
drop table if exists event_states cascade;
drop table if exists source_destination_mappings cascade;
drop table if exists calendars cascade;

create table calendars (
  "id" uuid primary key,
  "calendarType" text not null default 'google',
  "capabilities" text[] not null default '{}',
  "disabled" boolean not null default false,
  "ingestLastSucceededAt" timestamptz
);

create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "sourceCalendarId" uuid not null,
  "destinationCalendarId" uuid not null,
  "writeBackMode" text not null default 'off',
  "writeBackState" text not null default 'ok',
  "writeBackStateReason" text
);

create table event_states (
  "id" uuid primary key,
  "description" text,
  "endTime" timestamptz not null,
  "isAllDay" boolean,
  "location" text,
  "sourceEventId" text,
  "sourceEventUid" text,
  "startTime" timestamptz not null,
  "startTimeZone" text,
  "title" text
);

create table event_mappings (
  "id" uuid primary key,
  "calendarId" uuid not null,
  "deleteIdentifier" text,
  "destinationEventUid" text not null,
  "eventStateId" uuid references event_states("id") on delete set null,
  "sourceCalendarId" uuid,
  "syncEventHash" text,
  "writeBackAbandonCount" integer not null default 0,
  "writeBackAppliedCount" integer not null default 0,
  "writeBackPermanentCount" integer not null default 0,
  "writeBackEpoch" integer not null default 0,
  "writeBackEpochWindowStart" timestamptz,
  "writeBackLastAppliedAt" timestamptz
);

create table event_write_back_tombstones (
  "appliedAt" timestamptz not null default now(),
  "destinationCalendarId" uuid not null,
  "eventMappingId" uuid not null,
  "eventStateId" uuid,
  "expiresAt" timestamptz not null,
  "id" uuid primary key default gen_random_uuid(),
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

const identifier = (slot: number): string =>
  `1111111${slot}-1111-4111-8111-111111111111`;

const mappingId = (pass: number): string =>
  `2222222${pass}-1111-4111-8111-111111111111`;

const writer = {
  deleteEvent: () => Promise.resolve({ success: true }),
  updateEvent: () => Promise.resolve({ success: true }),
};

let client: SQL | null = null;

const seed = async (): Promise<void> => {
  const setup = new SQL({ max: 2, prepare: false, url: administrativeUrl });
  await setup.unsafe(DDL);
  for (let pass = 0; pass < CONCURRENT_PASSES; pass += 1) {
    const source = identifier(pass * 3);
    const destination = identifier(pass * 3 + 1);
    const eventState = identifier(pass * 3 + 2);
    await setup.unsafe(`insert into calendars ("id") values ($1), ($2)`, [source, destination]);
    await setup.unsafe(
      `insert into event_states ("id","endTime","startTime","sourceEventUid","title")
       values ($1, now(), now(), $2, 'Quarterly review')`,
      [eventState, `source-uid-${pass}`],
    );
    await setup.unsafe(
      `insert into event_mappings
         ("id","calendarId","destinationEventUid","eventStateId","sourceCalendarId","deleteIdentifier")
       values ($1,$2,$3,$4,$5,$6)`,
      [mappingId(pass), destination, `dest-uid-${pass}`, eventState, source, `dest-delete-${pass}`],
    );
  }
  await setup.end();
};

const runPass = (
  database: BunSQLDatabase,
  pass: number,
): Promise<WriteBackPassResult> => {
  const store = createDatabaseWriteBackStore({
    database,
    probeDestinationEvent: () => Promise.resolve("absent" as const),
    userId: "user-1",
  } as unknown as WriteBackApplierConfig);

  return runWriteBackPass({
    calendarId: identifier(pass * 3 + 1),
    classifications: [{
      expectedSource: {
        description: "",
        endTime: new Date(),
        isAllDay: false,
        location: "",
        startTime: new Date(),
        summary: "Quarterly review",
      },
      expectedSyncEventHash: null,
      mappingId: mappingId(pass),
      sourceEventUid: `source-uid-${pass}`,
      type: "delete",
    }] as never,
    store: { ...store, resolveWriter: () => Promise.resolve(writer) } as never,
  });
};

beforeAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await seed();
  client = new SQL({ max: POOL_CONNECTIONS, prepare: false, url: administrativeUrl });
});

afterAll(async () => {
  await client?.close({ timeout: 0 });
});

describe.skipIf(!administrativeUrl)(
  "a write-back delete that turns back does not hold two pool connections at once",
  () => {
    it("finishes as many concurrent passes as the pool has connections", async () => {
      const database = drizzle({ client: client as SQL }) as unknown as BunSQLDatabase;
      const passes = Array.from(
        { length: CONCURRENT_PASSES },
        (_unused, pass) => runPass(database, pass),
      );

      const outcome = await Promise.race([
        Promise.all(passes),
        new Promise<"stalled">((resolve) => {
          setTimeout(() => { resolve("stalled"); }, PASS_DEADLINE_MS);
        }),
      ]);

      expect(outcome).not.toBe("stalled");
      expect(outcome).toEqual(
        passes.map(() => ({
          abandoned: 0,
          applied: 0,
          failed: 0,
          heldForGrant: 0,
          quarantined: 0,
          withheld: 1,
        })),
      );
    }, PASS_DEADLINE_MS * 3);
  },
);
