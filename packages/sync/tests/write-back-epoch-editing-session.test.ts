import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TWO_WAY_EPOCH_QUARANTINE_LIMIT } from "@keeper.sh/calendar";
import { eventMappingsTable } from "@keeper.sh/database/schema";
import { buildEpochAssignment } from "../src/write-back";

const client = new PGlite();
const database = drizzle(client);

const MAPPING_ID = "11111111-1111-4111-8111-111111111111";
const EDITS = 5;
const ONE_MINUTE = 1;
const TEN_MINUTES = 10;

const DDL = `
create table event_mappings (
  "id" uuid primary key,
  "writeBackEpoch" integer not null default 0,
  "writeBackEpochWindowStart" timestamptz,
  "writeBackLastAppliedAt" timestamptz
);
`;

const commit = async (): Promise<number> => {
  const [row] = await database
    .update(eventMappingsTable)
    .set(buildEpochAssignment())
    .where(eq(eventMappingsTable.id, MAPPING_ID))
    .returning({ writeBackEpoch: eventMappingsTable.writeBackEpoch });
  return row?.writeBackEpoch ?? 0;
};

/*
 * Postgres has no clock this test can move, so the recorded instants are moved instead:
 * backdating everything the mapping remembers by the same amount is the same arithmetic
 * as waiting that long between two write-backs.
 */
const waitMinutes = async (minutes: number): Promise<void> => {
  await client.query(
    `update event_mappings
       set "writeBackEpochWindowStart" = "writeBackEpochWindowStart" - ($1 || ' minutes')::interval,
           "writeBackLastAppliedAt" = "writeBackLastAppliedAt" - ($1 || ' minutes')::interval
     where "id" = $2`,
    [String(minutes), MAPPING_ID],
  );
};

const runEdits = async (minutesApart: number): Promise<number[]> => {
  const epochs: number[] = [];
  for (let edit = 0; edit < EDITS; edit += 1) {
    epochs.push(await commit());
    await waitMinutes(minutesApart);
  }
  return epochs;
};

beforeEach(async () => {
  await client.exec(`drop table if exists event_mappings cascade;`);
  await client.exec(DDL);
  await client.query(`insert into event_mappings ("id") values ($1)`, [MAPPING_ID]);
});

/*
 * The epoch is what tells a destination generating changes on its own apart from a person
 * editing their copy, and reaching its limit reverts the whole pair to one-way and tells
 * the user the copies kept changing by themselves. A person moving one meeting, renaming
 * it and moving it again over a morning must never be counted as that: the write-backs all
 * succeeded, each carried a different value the user chose, and the pair they would take
 * down carries every other event as well.
 */
describe("the runaway epoch counts a run of write-backs, not an editing session", () => {
  it("starts a fresh run for edits minutes apart", async () => {
    const epochs = await runEdits(TEN_MINUTES);

    expect(Math.max(...epochs)).toBeLessThan(TWO_WAY_EPOCH_QUARANTINE_LIMIT);
  });

  it("still counts write-backs arriving on consecutive passes", async () => {
    const epochs = await runEdits(ONE_MINUTE);

    expect(Math.max(...epochs)).toBeGreaterThanOrEqual(TWO_WAY_EPOCH_QUARANTINE_LIMIT);
  });
});
