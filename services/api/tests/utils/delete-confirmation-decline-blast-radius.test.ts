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
const ONE_OBSERVATION = 1;
const STANDING_WITNESS = "the-copy-as-keeper-last-observed-it";

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
  "destinationEventUid" text,
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
 * The copy the question is about: it vanished from the destination listing, so its
 * observation is the evidence the answer is given against.
 */
const seedMissingCopy = async (): Promise<void> => {
  await client.query(
    `insert into event_mappings
       ("calendarId", "sourceCalendarId", "destinationEventUid",
        "destinationContentHash", "missingFirstObservedAt", "missingObservationCount")
     values ($1, $2, 'vanished-copy', 'vanished-copy-hash', now(), $3)`,
    [destinationCalendarId, sourceCalendarId, ONE_OBSERVATION],
  );
};

/*
 * A different copy on the same connection. It is still on the destination and the user
 * edited it while the pair was held on the question, so its write-back has not run yet.
 * The witness is the only record of what Keeper.sh last pushed to it, and the classifier
 * adopts the copy as the new baseline — swallowing the edit — the moment it is gone.
 */
const seedEditedCopy = async (): Promise<void> => {
  await client.query(
    `insert into event_mappings
       ("calendarId", "sourceCalendarId", "destinationEventUid",
        "destinationContentHash", "destinationSummary")
     values ($1, $2, 'edited-copy', $3, 'Quarterly review')`,
    [destinationCalendarId, sourceCalendarId, STANDING_WITNESS],
  );
};

const readWitness = async (
  destinationEventUid: string,
): Promise<string | null> => {
  const result = await client.query<{ destinationContentHash: string | null }>(
    `select "destinationContentHash" from event_mappings
     where "destinationEventUid" = $1`,
    [destinationEventUid],
  );
  const [row] = result.rows;
  if (!row) {
    throw new Error("The seeded mapping disappeared");
  }
  return row.destinationContentHash;
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
  await seedMissingCopy();
  await seedEditedCopy();
});

/*
 * Declining answers one question — whether the copies that vanished were really deleted —
 * and the answer is "no, put them back". The copies it speaks for are the ones that went
 * missing. Every other copy on the connection is still there, and the pause is what stopped
 * the edits made on them from being written back: the dashboard tells the user those changes
 * "are not written back in the meantime", which is a promise that answering releases them.
 *
 * Clearing the witness on a copy that never went missing breaks that promise silently. With
 * no witness the classifier adopts whatever the destination reports as the new baseline, so
 * the edit is neither written back to the original nor put back on the copy: the user is
 * left looking at a time on their copy that the real event does not have, with nothing
 * anywhere to notice it.
 */
describe("declining a deletion", () => {
  it("drops the observation for the copies the question was about", async () => {
    await resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "revert",
    );

    expect(await readWitness("vanished-copy")).toBeNull();
  });

  it("leaves a still-present copy's witness alone so its edit is still written back", async () => {
    await resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "revert",
    );

    expect(await readWitness("edited-copy")).toBe(STANDING_WITNESS);
  });
});
