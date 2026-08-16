import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  createDeleteConfirmationRecorder,
  createWriteBackHoldRecorder,
} from "../src/sync-user";

const client = new PGlite();
const database = drizzle(client) as unknown as BunSQLDatabase;

const SOURCE_CALENDAR_ID = "11111111-1111-4111-8111-111111111111";
const DESTINATION_CALENDAR_ID = "22222222-2222-4222-8222-222222222222";

const DDL = `
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "destinationCalendarId" uuid not null,
  "sourceCalendarId" uuid not null,
  "writeBackMode" text not null default 'off',
  "writeBackState" text not null default 'ok',
  "writeBackStateReason" text
);
`;

const holdWriteBack = createWriteBackHoldRecorder(database, DESTINATION_CALENDAR_ID);
const requestDeleteConfirmation = createDeleteConfirmationRecorder(
  database,
  DESTINATION_CALENDAR_ID,
);

const readPair = async (): Promise<{ reason: string | null; state: string }> => {
  const result = await client.query<{
    writeBackState: string;
    writeBackStateReason: string | null;
  }>(
    `select "writeBackState", "writeBackStateReason" from source_destination_mappings
     where "sourceCalendarId" = $1`,
    [SOURCE_CALENDAR_ID],
  );
  const [row] = result.rows;
  if (!row) {
    throw new Error("The pair under test is missing");
  }
  return { reason: row.writeBackStateReason, state: row.writeBackState };
};

beforeEach(async () => {
  await client.exec(`drop table if exists source_destination_mappings cascade;`);
  await client.exec(DDL);
  await client.query(
    `insert into source_destination_mappings
       ("destinationCalendarId", "sourceCalendarId", "writeBackMode")
     values ($1, $2, 'edits_and_deletes')`,
    [DESTINATION_CALENDAR_ID, SOURCE_CALENDAR_ID],
  );
});

/*
 * One pass can trip both breakers on the same pair: copies vanished in bulk and other copies
 * moved in bulk. Both recorders write the same row, so whichever writes second decides what
 * the user is told. The question about the copies that vanished has to survive: quarantine
 * reverts the pair to one-way, which re-creates the very copies the question is about and
 * strands their pending state, while the question keeps the mode and pauses the pair. No
 * source is written under either state, so nothing is lost by holding the question.
 */
describe("a pass that trips both write-back breakers on one pair", () => {
  it("keeps the delete question when the quarantine is recorded second", async () => {
    await requestDeleteConfirmation({
      reason: "delete_breaker_tripped",
      sourceCalendarIds: [SOURCE_CALENDAR_ID],
    });
    await holdWriteBack({
      reason: "bulk_edit_breaker",
      sourceCalendarIds: [SOURCE_CALENDAR_ID],
    });

    expect(await readPair()).toEqual({
      reason: "delete_breaker_tripped",
      state: "delete_confirmation_required",
    });
  });

  it("keeps the delete question when the quarantine is recorded first", async () => {
    await holdWriteBack({
      reason: "bulk_edit_breaker",
      sourceCalendarIds: [SOURCE_CALENDAR_ID],
    });
    await requestDeleteConfirmation({
      reason: "delete_breaker_tripped",
      sourceCalendarIds: [SOURCE_CALENDAR_ID],
    });

    expect(await readPair()).toEqual({
      reason: "delete_breaker_tripped",
      state: "delete_confirmation_required",
    });
  });

  it("still quarantines a pair that has no question standing against it", async () => {
    await holdWriteBack({
      reason: "bulk_edit_breaker",
      sourceCalendarIds: [SOURCE_CALENDAR_ID],
    });

    expect(await readPair()).toEqual({
      reason: "bulk_edit_breaker",
      state: "quarantined",
    });
  });
});
