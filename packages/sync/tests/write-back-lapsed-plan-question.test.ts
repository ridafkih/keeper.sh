import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  eventMappingsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { resolveWriteBackPolicies } from "../src/sync-user";

const client = new PGlite();
const database = drizzle(client) as unknown as BunSQLDatabase;

const DESTINATION_CALENDAR_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_CALENDAR_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_SOURCE_CALENDAR_ID = "33333333-3333-4333-8333-333333333333";
const MAPPING_ID = "44444444-4444-4444-8444-444444444444";
const APPROVED_AT = new Date("2027-05-01T12:00:00.000Z");

/*
 * Only the columns the downgrade reads and writes. The pair rows and the mappings they own
 * are what the plan check touches; nothing here joins to a calendar.
 */
const DDL = `
create table source_destination_mappings (
  "id" uuid primary key,
  "destinationCalendarId" uuid not null,
  "sourceCalendarId" uuid not null,
  "deleteConfirmationApprovedAt" timestamptz,
  "writeBackMode" text not null default 'off',
  "writeBackState" text not null default 'ok',
  "writeBackStateReason" text
);
create table event_mappings (
  "id" uuid primary key,
  "calendarId" uuid not null,
  "sourceCalendarId" uuid,
  "destinationAvailability" text,
  "destinationContentHash" text,
  "destinationDescription" text,
  "destinationEndTime" timestamptz,
  "destinationIsAllDay" boolean,
  "destinationLocation" text,
  "destinationStartTime" timestamptz,
  "destinationSummary" text,
  "writeBackDailyCount" integer not null default 0,
  "writeBackDailyWindowStart" timestamptz,
  "writeBackEpoch" integer not null default 0,
  "writeBackEpochWindowStart" timestamptz,
  "writeBackLastAppliedAt" timestamptz
);
`;

const seedPair = async (
  sourceCalendarId: string,
  pair: { state: string; reason: string | null },
): Promise<void> => {
  await client.query(
    `insert into source_destination_mappings
       ("id", "destinationCalendarId", "sourceCalendarId",
        "deleteConfirmationApprovedAt", "writeBackMode", "writeBackState",
        "writeBackStateReason")
     values (gen_random_uuid(), $1, $2, $3, 'edits_and_deletes', $4, $5)`,
    [DESTINATION_CALENDAR_ID, sourceCalendarId, APPROVED_AT, pair.state, pair.reason],
  );
};

const seedWitnessedMapping = async (): Promise<void> => {
  await client.query(
    `insert into event_mappings
       ("id", "calendarId", "sourceCalendarId", "destinationSummary",
        "destinationContentHash", "writeBackEpoch")
     values ($1, $2, $3, 'Renamed by the user on the copy', 'observed-hash', 3)`,
    [MAPPING_ID, DESTINATION_CALENDAR_ID, SOURCE_CALENDAR_ID],
  );
};

const readPair = async (sourceCalendarId: string) => {
  const [row] = await database
    .select({
      deleteConfirmationApprovedAt:
        sourceDestinationMappingsTable.deleteConfirmationApprovedAt,
      writeBackState: sourceDestinationMappingsTable.writeBackState,
      writeBackStateReason: sourceDestinationMappingsTable.writeBackStateReason,
    })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId));
  return row;
};

beforeEach(async () => {
  await client.exec(`drop table if exists source_destination_mappings cascade;`);
  await client.exec(`drop table if exists event_mappings cascade;`);
  await client.exec(DDL);
});

/*
 * A plan that lapses while the pair is standing on a delete question. The question's own
 * hold lives in a write-back policy, and a lapsed plan returns no policies at all — so the
 * copies are rebuilt from the source on the next pass whatever the stored state says. The
 * stored state is therefore the only thing that can still tell the user the truth about
 * what is happening to their copies.
 */
describe("a delete question that outlives the plan", () => {
  it("tells the user the plan lapsed rather than leaving the question standing", async () => {
    await seedPair(SOURCE_CALENDAR_ID, {
      reason: "all_copies_missing",
      state: "delete_confirmation_required",
    });

    const policies = await resolveWriteBackPolicies(
      database,
      DESTINATION_CALENDAR_ID,
      "free",
    );

    expect(policies.size).toBe(0);
    expect(await readPair(SOURCE_CALENDAR_ID)).toEqual({
      deleteConfirmationApprovedAt: null,
      writeBackState: "quarantined",
      writeBackStateReason: "plan_downgraded",
    });
  });

  it("drops the observations recorded under the policy the lapse revoked", async () => {
    await seedPair(SOURCE_CALENDAR_ID, {
      reason: "all_copies_missing",
      state: "delete_confirmation_required",
    });
    await seedWitnessedMapping();

    await resolveWriteBackPolicies(database, DESTINATION_CALENDAR_ID, "free");

    const [mapping] = await database
      .select({
        destinationContentHash: eventMappingsTable.destinationContentHash,
        destinationSummary: eventMappingsTable.destinationSummary,
        writeBackEpoch: eventMappingsTable.writeBackEpoch,
      })
      .from(eventMappingsTable)
      .where(eq(eventMappingsTable.id, MAPPING_ID));

    expect(mapping).toEqual({
      destinationContentHash: null,
      destinationSummary: null,
      writeBackEpoch: 0,
    });
  });

  /*
   * Paying for the plan is no answer to a safety stop about the calendars themselves, so a
   * pair already stopped for one keeps the reason it stopped for — and is not handed back
   * by the restore that lifts a plan pause.
   */
  it("leaves a pair stopped for a safety reason carrying that reason", async () => {
    await seedPair(OTHER_SOURCE_CALENDAR_ID, {
      reason: "source_event_has_attendees",
      state: "quarantined",
    });

    await resolveWriteBackPolicies(database, DESTINATION_CALENDAR_ID, "free");

    expect(await readPair(OTHER_SOURCE_CALENDAR_ID)).toMatchObject({
      writeBackState: "quarantined",
      writeBackStateReason: "source_event_has_attendees",
    });
  });
});
