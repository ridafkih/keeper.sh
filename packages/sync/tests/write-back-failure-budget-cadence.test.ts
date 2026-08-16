import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { TWO_WAY_EPOCH_QUARANTINE_LIMIT } from "@keeper.sh/calendar";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createDatabaseWriteBackStore } from "../src/write-back";
import type { WriteBackApplierConfig } from "../src/write-back";

const client = new PGlite();
const database = drizzle(client);

const MAPPING_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPTS = 8;
const ONE_MINUTE = 1;
const FIVE_MINUTES = 5;
const TWENTY_MINUTES = 20;

const DDL = `
create table event_mappings (
  "id" uuid primary key,
  "writeBackEpoch" integer not null default 0,
  "writeBackEpochWindowStart" timestamptz,
  "writeBackLastAppliedAt" timestamptz
);
`;

const store = createDatabaseWriteBackStore({
  database: database as unknown as BunSQLDatabase,
} as unknown as WriteBackApplierConfig);

/*
 * Postgres has no clock this test can move, so the recorded instants are moved instead:
 * backdating everything the mapping remembers by the same amount is the same arithmetic
 * as waiting that long between two passes.
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

const runFailures = async (minutesApart: number): Promise<number[]> => {
  const budget: number[] = [];
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    budget.push(await store.recordFailure(MAPPING_ID));
    await waitMinutes(minutesApart);
  }
  return budget;
};

beforeEach(async () => {
  await client.exec(`drop table if exists event_mappings cascade;`);
  await client.exec(DDL);
  await client.query(`insert into event_mappings ("id") values ($1)`, [MAPPING_ID]);
});

/*
 * The budget this spends is the only stop on every write-back escalation there is: the
 * quarantine that pauses a pair the source keeps rejecting, the guard that catches a
 * mapping whose epoch is spent, and — the one that matters most — the confirmation that
 * stops guessing and asks the user about a deletion Keeper.sh could not carry through. A
 * budget that never runs out means none of them ever fire and the retry loop is forever.
 *
 * A person editing the same event is told apart from a machine by how closely spaced the
 * write-backs are, which is why a successful one starts a fresh run after a quiet gap. A
 * failed attempt is neither a person nor progress: nobody chose it, nothing was written,
 * and how far apart the passes happen to land says nothing about whether the thing that
 * rejected the write has stopped rejecting it.
 */
describe("the write-back failure budget runs out whatever the pass cadence", () => {
  it("runs out on passes a minute apart", async () => {
    const budget = await runFailures(ONE_MINUTE);

    expect(Math.max(...budget)).toBeGreaterThanOrEqual(TWO_WAY_EPOCH_QUARANTINE_LIMIT);
  });

  it("runs out on passes five minutes apart", async () => {
    const budget = await runFailures(FIVE_MINUTES);

    expect(Math.max(...budget)).toBeGreaterThanOrEqual(TWO_WAY_EPOCH_QUARANTINE_LIMIT);
  });

  it("runs out on passes twenty minutes apart", async () => {
    const budget = await runFailures(TWENTY_MINUTES);

    expect(Math.max(...budget)).toBeGreaterThanOrEqual(TWO_WAY_EPOCH_QUARANTINE_LIMIT);
  });

  /*
   * The budget is a budget and not a lifetime tally: a mapping that failed once, was left
   * alone for an hour and fails again is not five passes into anything.
   */
  it("starts again for a mapping that has been quiet for an hour", async () => {
    await store.recordFailure(MAPPING_ID);
    await waitMinutes(61);

    expect(await store.recordFailure(MAPPING_ID)).toBe(1);
  });
});
