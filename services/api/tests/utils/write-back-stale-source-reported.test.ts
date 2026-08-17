import { PGlite } from "@electric-sql/pglite";
import { TWO_WAY_SOURCE_INGEST_MAX_AGE_MS } from "@keeper.sh/constants";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

vi.mock("@/context", () => ({ database }));

vi.mock("@/utils/background-task", () => ({
  spawnBackgroundJob: () => null,
}));

vi.mock("@/utils/enqueue-push-sync", () => ({
  enqueueMappingReplacementSync: () => Promise.resolve(),
  enqueuePushSync: () => Promise.resolve(),
}));

vi.mock("@keeper.sh/sync", () => ({
  createMappingMutationLockId: () => "lock-id",
  createSyncLock: () => ({ acquire: () => Promise.resolve({ acquired: false }) }),
}));

const { getWriteBackModesForSource, getWriteBackStatesForSource } = await import(
  "../../src/utils/source-destination-mappings"
);

const USER_ID = "user-1";

const DDL = `
create table caldav_credentials (
  "id" uuid primary key default gen_random_uuid(),
  "username" text not null
);
create table calendar_accounts (
  "id" uuid primary key default gen_random_uuid(),
  "caldavCredentialId" uuid,
  "email" text
);
create table calendars (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" uuid,
  "calendarType" text not null default 'google',
  "capabilities" text[] not null default '{pull,push}',
  "disabled" boolean not null default false,
  "ingestLastSucceededAt" timestamptz,
  "userId" text not null
);
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "sourceCalendarId" uuid not null,
  "destinationCalendarId" uuid not null,
  "copiesMissingObservedAt" timestamptz,
  "deleteConfirmationApprovedAt" timestamptz,
  "lastHealthyReadAt" timestamptz,
  "writeBackMode" text not null default 'off',
  "writeBackState" text not null default 'ok',
  "writeBackStateReason" text
  ,"writeBackReach" text not null default 'own_events'
);
`;

const insertCalendar = async (ingestLastSucceededAt: Date | null): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `insert into calendars ("ingestLastSucceededAt", "userId") values ($1, $2) returning "id"`,
    [ingestLastSucceededAt, USER_ID],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to seed a calendar");
  }
  return id;
};

const insertMapping = async (
  sourceCalendarId: string,
  destinationCalendarId: string,
): Promise<void> => {
  await client.query(
    `insert into source_destination_mappings
       ("sourceCalendarId", "destinationCalendarId", "writeBackMode")
     values ($1, $2, 'edits_and_deletes')`,
    [sourceCalendarId, destinationCalendarId],
  );
};

beforeEach(async () => {
  await client.exec(`drop table if exists source_destination_mappings cascade;`);
  await client.exec(`drop table if exists calendars cascade;`);
  await client.exec(`drop table if exists calendar_accounts cascade;`);
  await client.exec(`drop table if exists caldav_credentials cascade;`);
  await client.exec(DDL);
});

/*
 * A source Keeper.sh has not read inside TWO_WAY_SOURCE_INGEST_MAX_AGE_MS suspends two-way
 * sync for every pair hanging off it: getWriteBackPoliciesForDestination stamps the policy
 * paused, and readPairWriteBack answers "off" under the source lock. Nothing is written
 * back and no copy is rebuilt for as long as the ingest stays behind — and an ingest that
 * starts failing backs off up to six hours per attempt.
 *
 * The dashboard is told none of it. The pair still reports the mode it stores and a state
 * of "ok", so the screen reads "Two-way, including deletions / editing the copy changes the
 * original event here" with no status line, in the present tense, while nothing of the sort
 * is happening. Every other suspension the product has is disclosed: a paused calendar and
 * a revoked write grant are reported as off with an explanation, and a quarantine, a plan
 * downgrade and a pending delete question each raise a status line.
 */
const HELD = { reason: "source_not_read_recently", state: "paused" };

describe("a pair whose source has not been read inside the two-way freshness window", () => {
  it("reports the hold rather than a healthy two-way connection", async () => {
    const stale = new Date(Date.now() - TWO_WAY_SOURCE_INGEST_MAX_AGE_MS - 60_000);
    const sourceCalendarId = await insertCalendar(stale);
    const destinationCalendarId = await insertCalendar(new Date());
    await insertMapping(sourceCalendarId, destinationCalendarId);

    const states = await getWriteBackStatesForSource(USER_ID, sourceCalendarId);

    expect(states[destinationCalendarId]).toMatchObject(HELD);
  });

  it("reports the hold on a source that has never been read at all", async () => {
    const sourceCalendarId = await insertCalendar(null);
    const destinationCalendarId = await insertCalendar(new Date());
    await insertMapping(sourceCalendarId, destinationCalendarId);

    const states = await getWriteBackStatesForSource(USER_ID, sourceCalendarId);

    expect(states[destinationCalendarId]).toMatchObject(HELD);
  });

  /*
   * The hold is not the user unpicking two-way, and it undoes itself, so the stored mode
   * stays reported: flipping the control to One-way would misstate their own setting and
   * invite them to re-pick something that was never unpicked.
   */
  it("keeps reporting the mode the pair stores while it is held", async () => {
    const stale = new Date(Date.now() - TWO_WAY_SOURCE_INGEST_MAX_AGE_MS - 60_000);
    const sourceCalendarId = await insertCalendar(stale);
    const destinationCalendarId = await insertCalendar(new Date());
    await insertMapping(sourceCalendarId, destinationCalendarId);

    const modes = await getWriteBackModesForSource(USER_ID, sourceCalendarId);

    expect(modes[destinationCalendarId]).toBe("edits_and_deletes");
  });

  it("reports nothing of the sort on a source read inside the window", async () => {
    const sourceCalendarId = await insertCalendar(new Date());
    const destinationCalendarId = await insertCalendar(new Date());
    await insertMapping(sourceCalendarId, destinationCalendarId);

    const modes = await getWriteBackModesForSource(USER_ID, sourceCalendarId);
    const states = await getWriteBackStatesForSource(USER_ID, sourceCalendarId);

    expect(modes[destinationCalendarId]).toBe("edits_and_deletes");
    expect(states[destinationCalendarId]).toMatchObject({ reason: null, state: "ok" });
  });

  /*
   * A pair already stopped for a reason of its own keeps that reason. Overwriting a
   * quarantine with the staleness note would hide the answer the user has to give.
   */
  it("leaves a pair that is already stopped reporting why it stopped", async () => {
    const stale = new Date(Date.now() - TWO_WAY_SOURCE_INGEST_MAX_AGE_MS - 60_000);
    const sourceCalendarId = await insertCalendar(stale);
    const destinationCalendarId = await insertCalendar(new Date());
    await insertMapping(sourceCalendarId, destinationCalendarId);
    await client.query(
      `update source_destination_mappings
         set "writeBackState" = 'quarantined', "writeBackStateReason" = 'runaway_write_back'`,
    );

    const states = await getWriteBackStatesForSource(USER_ID, sourceCalendarId);

    expect(states[destinationCalendarId]).toMatchObject({
      reason: "runaway_write_back",
      state: "quarantined",
    });
  });
});
