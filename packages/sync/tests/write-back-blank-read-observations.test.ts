import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  createDeleteConfirmationRecorder,
  createHealthyReadRecorder,
} from "../src/sync-user";

const client = new PGlite();
const database = drizzle(client) as unknown as BunSQLDatabase;

const SOURCE_CALENDAR_ID = "11111111-1111-4111-8111-111111111111";
const SIBLING_SOURCE_CALENDAR_ID = "33333333-3333-4333-8333-333333333333";
const DESTINATION_CALENDAR_ID = "22222222-2222-4222-8222-222222222222";

const DDL = `
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "copiesMissingObservedAt" timestamptz,
  "destinationCalendarId" uuid not null,
  "lastHealthyReadAt" timestamptz,
  "sourceCalendarId" uuid not null,
  "writeBackMode" text not null default 'off',
  "writeBackState" text not null default 'ok',
  "writeBackStateReason" text
);
`;

const requestDeleteConfirmation = createDeleteConfirmationRecorder(
  database,
  DESTINATION_CALENDAR_ID,
);
const recordHealthyRead = createHealthyReadRecorder(database, DESTINATION_CALENDAR_ID);

interface Observations {
  copiesMissingObservedAt: Date | null;
  lastHealthyReadAt: Date | null;
}

const readObservations = async (sourceCalendarId: string): Promise<Observations> => {
  const result = await client.query<Observations>(
    `select "copiesMissingObservedAt", "lastHealthyReadAt"
     from source_destination_mappings where "sourceCalendarId" = $1`,
    [sourceCalendarId],
  );
  const [row] = result.rows;
  if (!row) {
    throw new Error("The pair under test is missing");
  }
  return row;
};

beforeEach(async () => {
  await client.exec(`drop table if exists source_destination_mappings cascade;`);
  await client.exec(DDL);
  await client.query(
    `insert into source_destination_mappings
       ("destinationCalendarId", "sourceCalendarId", "writeBackMode")
     values ($1, $2, 'edits_and_deletes'), ($1, $3, 'edits_and_deletes')`,
    [DESTINATION_CALENDAR_ID, SOURCE_CALENDAR_ID, SIBLING_SOURCE_CALENDAR_ID],
  );
});

/*
 * "Delete the originals" is offered on two observations and nothing else: when the copies
 * were first found missing, and when a read last came back with at least one of them.
 * Neither survives the pass that saw it, so both are recorded on the pair — the
 * granularity the question is asked at and the answer given at.
 */
describe("what a pass records for the blank-read delete gate", () => {
  it("stamps the disappearance when the copies could not be read at all", async () => {
    await requestDeleteConfirmation({
      reason: "all_copies_missing",
      sourceCalendarIds: [SOURCE_CALENDAR_ID],
    });

    const observed = await readObservations(SOURCE_CALENDAR_ID);

    expect(observed.copiesMissingObservedAt).toBeInstanceOf(Date);
    expect(observed.lastHealthyReadAt).toBeNull();
  });

  /*
   * The breaker trips on a read that returned items, so it carries its own evidence that
   * the destination is readable. Stamping a disappearance for it would gate the one route
   * out for a destination the user really did empty.
   */
  it("stamps no disappearance for a breaker trip", async () => {
    await requestDeleteConfirmation({
      reason: "delete_breaker_tripped",
      sourceCalendarIds: [SOURCE_CALENDAR_ID],
    });

    const observed = await readObservations(SOURCE_CALENDAR_ID);

    expect(observed.copiesMissingObservedAt).toBeNull();
  });

  it("stamps the healthy read only on the pairs that read covered", async () => {
    await recordHealthyRead([SOURCE_CALENDAR_ID]);

    const covered = await readObservations(SOURCE_CALENDAR_ID);
    const untouched = await readObservations(SIBLING_SOURCE_CALENDAR_ID);

    expect(covered.lastHealthyReadAt).toBeInstanceOf(Date);
    expect(untouched.lastHealthyReadAt).toBeNull();
  });

  it("records the healthy read after the disappearance it clears", async () => {
    await requestDeleteConfirmation({
      reason: "all_copies_missing",
      sourceCalendarIds: [SOURCE_CALENDAR_ID],
    });
    await recordHealthyRead([SOURCE_CALENDAR_ID]);

    const { copiesMissingObservedAt, lastHealthyReadAt } = await readObservations(
      SOURCE_CALENDAR_ID,
    );

    expect(copiesMissingObservedAt).toBeInstanceOf(Date);
    expect(lastHealthyReadAt).toBeInstanceOf(Date);
    expect(lastHealthyReadAt?.getTime()).toBeGreaterThanOrEqual(
      copiesMissingObservedAt?.getTime() ?? 0,
    );
  });
});
