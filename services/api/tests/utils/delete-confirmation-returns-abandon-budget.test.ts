import { PGlite } from "@electric-sql/pglite";
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

const { resolveDeleteConfirmation } = await import(
  "../../src/utils/source-destination-mappings"
);

const USER_ID = "user-1";
const MINUTE_MS = 60_000;
const WAITING = "delete_confirmation_required";
const COPIES_MISSING = "all_copies_missing";
const SPENT_ABANDONS = 4;
const NO_ABANDONS = 0;
const RECORDED_EPOCH = 2;
const OBSERVED_MISSING_TWICE = 2;

const DDL = `
create table calendar_accounts (
  "id" uuid primary key default gen_random_uuid(),
  "needsReauthentication" boolean not null default false,
  "userId" text not null
);
create table calendars (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" uuid not null,
  "disabled" boolean not null default false,
  "userId" text not null
);
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "copiesMissingObservedAt" timestamp,
  "createdAt" timestamp not null default now(),
  "deleteConfirmationApprovedAt" timestamp,
  "destinationCalendarId" uuid not null,
  "lastHealthyReadAt" timestamp,
  "sourceCalendarId" uuid not null,
  "writeBackEnabledAt" timestamp,
  "writeBackMode" text not null default 'off',
  "writeBackState" text not null default 'ok',
  "writeBackStateReason" text
  ,"writeBackReach" text not null default 'own_events'
);
create table event_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "calendarId" uuid not null,
  "createdAt" timestamp not null default now(),
  "destinationAvailability" text,
  "destinationContentHash" text,
  "destinationDescription" text,
  "destinationEndTime" timestamp,
  "destinationIsAllDay" boolean,
  "destinationLocation" text,
  "destinationStartTime" timestamp,
  "destinationSummary" text,
  "endTime" timestamp not null default now(),
  "missingFirstObservedAt" timestamp,
  "missingObservationCount" integer not null default 0,
  "sourceCalendarId" uuid,
  "startTime" timestamp not null default now(),
  "syncEventHash" text,
  "syncEventId" text,
  "writeBackAbandonCount" integer not null default 0,
  "writeBackAppliedCount" integer not null default 0,
  "writeBackDailyCount" integer not null default 0,
  "writeBackDailyWindowStart" timestamp,
  "writeBackPermanentCount" integer not null default 0,
  "writeBackEpoch" integer not null default 0,
  "writeBackEpochWindowStart" timestamp,
  "writeBackLastAppliedAt" timestamp
);
create table user_sync_requests (
  "requestId" uuid not null default gen_random_uuid(),
  "requestedAt" timestamp not null default now(),
  "userId" text primary key
);
`;

interface EventMappingBudget {
  destinationContentHash: string | null;
  writeBackAbandonCount: number;
  writeBackEpoch: number;
}

let accountId = "";
let sourceCalendarId = "";
let destinationCalendarId = "";

const insertAccount = async (): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `insert into calendar_accounts ("userId") values ($1) returning "id"`,
    [USER_ID],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to seed a calendar account");
  }
  return id;
};

const insertCalendar = async (): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `insert into calendars ("accountId", "userId") values ($1, $2) returning "id"`,
    [accountId, USER_ID],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to seed a calendar");
  }
  return id;
};

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * MINUTE_MS);

const seedPair = async (): Promise<void> => {
  await client.query(
    `insert into source_destination_mappings
       ("destinationCalendarId", "sourceCalendarId", "writeBackMode",
        "writeBackState", "writeBackStateReason",
        "copiesMissingObservedAt", "lastHealthyReadAt")
     values ($1, $2, 'edits_and_deletes', $3, $4, $5, $6)`,
    [
      destinationCalendarId,
      sourceCalendarId,
      WAITING,
      COPIES_MISSING,
      minutesAgo(20),
      minutesAgo(5),
    ],
  );
};

/*
 * A mapping one abandon short of escalating again, with the hour-long window it was spent
 * in still live — exactly the row a pass leaves behind when the per-event delete probe kept
 * answering "still present" or "cannot look" right up to the question the user is now
 * answering.
 */
const seedSpentMapping = async (): Promise<void> => {
  await client.query(
    `insert into event_mappings
       ("calendarId", "sourceCalendarId", "destinationContentHash",
        "missingFirstObservedAt", "missingObservationCount",
        "writeBackAbandonCount", "writeBackEpoch", "writeBackEpochWindowStart")
     values ($1, $2, 'observed-content-hash', $3, $4, $5, $6, now())`,
    [
      destinationCalendarId,
      sourceCalendarId,
      minutesAgo(20),
      OBSERVED_MISSING_TWICE,
      SPENT_ABANDONS,
      RECORDED_EPOCH,
    ],
  );
};

const readMappingBudget = async (): Promise<EventMappingBudget> => {
  const result = await client.query<EventMappingBudget>(
    `select "destinationContentHash", "writeBackAbandonCount", "writeBackEpoch"
     from event_mappings where "sourceCalendarId" = $1`,
    [sourceCalendarId],
  );
  const [row] = result.rows;
  if (!row) {
    throw new Error("The seeded mapping disappeared");
  }
  return row;
};

beforeEach(async () => {
  await client.exec(`
    drop table if exists user_sync_requests, event_mappings,
      source_destination_mappings, calendars, calendar_accounts cascade;
  `);
  await client.exec(DDL);
  accountId = await insertAccount();
  sourceCalendarId = await insertCalendar();
  destinationCalendarId = await insertCalendar();
  await seedPair();
  await seedSpentMapping();
});

/*
 * Answering "yes, delete the originals" clears the pair's pause but leaves every
 * event_mappings row untouched. The abandon budget those rows spent reaching the pause is
 * still spent, so the first abandon of the next pass escalates again and re-arms the same
 * question — under a reason the approve endpoint refuses, which leaves the user with no
 * answer but Decline and reverses the batch they just approved.
 */
describe("approving a deletion returns the budget the pause was reached on", () => {
  it("hands the abandon budget back so the approved batch can actually run", async () => {
    await resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "apply",
    );

    const budget = await readMappingBudget();

    expect(budget.writeBackAbandonCount).toBe(NO_ABANDONS);
  });

  /*
   * Only the budget. The observation is what identifies the copies the approval is about,
   * so clearing it here would make every copy read as never observed and cancel the
   * deletions the user just approved.
   */
  it("keeps the observation the approval was given about", async () => {
    await resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "apply",
    );

    expect(await readMappingBudget()).toMatchObject({
      destinationContentHash: "observed-content-hash",
      writeBackEpoch: RECORDED_EPOCH,
    });
  });

  /*
   * Declining reverses the batch and puts the copies back, so it drops the observation and
   * every budget with it — the path that already worked, pinned here so returning the
   * abandon budget on approval cannot be mistaken for the same thing.
   */
  it("still drops the whole observation when the user declines instead", async () => {
    await resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "revert",
    );

    expect(await readMappingBudget()).toMatchObject({
      destinationContentHash: null,
      writeBackAbandonCount: NO_ABANDONS,
      writeBackEpoch: NO_ABANDONS,
    });
  });
});
