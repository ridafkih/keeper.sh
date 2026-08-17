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

interface PairState {
  deleteConfirmationApprovedAt: Date | null;
  writeBackState: string;
  writeBackStateReason: string | null;
}

const MINUTE_MS = 60_000;
const WAITING = "delete_confirmation_required";
const COPIES_MISSING = "all_copies_missing";

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

const seedPair = async (observations: {
  approvedAt: Date | null;
  copiesMissingObservedAt: Date | null;
  lastHealthyReadAt: Date | null;
  writeBackStateReason: string | null;
}): Promise<void> => {
  await client.query(
    `insert into source_destination_mappings
       ("destinationCalendarId", "sourceCalendarId", "writeBackMode",
        "writeBackState", "writeBackStateReason",
        "copiesMissingObservedAt", "lastHealthyReadAt", "deleteConfirmationApprovedAt")
     values ($1, $2, 'edits_and_deletes', $3, $4, $5, $6, $7)`,
    [
      destinationCalendarId,
      sourceCalendarId,
      WAITING,
      observations.writeBackStateReason,
      observations.copiesMissingObservedAt,
      observations.lastHealthyReadAt,
      observations.approvedAt,
    ],
  );
};

const readPair = async (): Promise<PairState> => {
  const result = await client.query<PairState>(
    `select "deleteConfirmationApprovedAt", "writeBackState", "writeBackStateReason"
     from source_destination_mappings where "sourceCalendarId" = $1`,
    [sourceCalendarId],
  );
  const [row] = result.rows;
  if (!row) {
    throw new Error("The seeded pair disappeared");
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
});

/*
 * The half-hour lifetime of an approval carries the tail of the batch it was given for
 * through, and nothing else. An answer given before these copies were found missing was an
 * answer about other copies — a breaker trip minutes earlier, an earlier disappearance that
 * was settled — and reading it as consent for this one unlocks exactly the reading the gate
 * exists to refuse: a destination that went unreachable and came back empty.
 */
describe("an approval only covers disappearances that were already observed when it was given", () => {
  it("refuses an approval stamped before the copies went missing, with no healthy read at all", async () => {
    await seedPair({
      approvedAt: minutesAgo(10),
      copiesMissingObservedAt: minutesAgo(8),
      lastHealthyReadAt: null,
      writeBackStateReason: COPIES_MISSING,
    });

    await expect(resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "apply",
    )).rejects.toThrow();

    expect(await readPair()).toMatchObject({
      writeBackState: WAITING,
      writeBackStateReason: COPIES_MISSING,
    });
  });

  it("refuses it when the last healthy read is older than the disappearance", async () => {
    await seedPair({
      approvedAt: minutesAgo(10),
      copiesMissingObservedAt: minutesAgo(1),
      lastHealthyReadAt: minutesAgo(9),
      writeBackStateReason: COPIES_MISSING,
    });

    await expect(resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "apply",
    )).rejects.toThrow();

    expect(await readPair()).toMatchObject({
      writeBackState: WAITING,
      writeBackStateReason: COPIES_MISSING,
    });
  });

  it("still accepts one stamped after the copies went missing, inside its lifetime", async () => {
    await seedPair({
      approvedAt: minutesAgo(5),
      copiesMissingObservedAt: minutesAgo(20),
      lastHealthyReadAt: null,
      writeBackStateReason: COPIES_MISSING,
    });

    await resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "apply",
    );

    const pair = await readPair();
    expect(pair.deleteConfirmationApprovedAt).toBeInstanceOf(Date);
    expect(pair.writeBackState).toBe("ok");
  });

  it("still accepts one on a read that came back with a copy since", async () => {
    await seedPair({
      approvedAt: null,
      copiesMissingObservedAt: minutesAgo(20),
      lastHealthyReadAt: minutesAgo(2),
      writeBackStateReason: COPIES_MISSING,
    });

    await resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "apply",
    );

    expect(await readPair()).toMatchObject({ writeBackState: "ok" });
  });
});

/*
 * A destination calendar that holds nothing but the copies can never produce a reading that
 * comes back with one, so the reading-based route is closed to it for good. The way through
 * is the user's own word, given as its own answer — and refused where Keeper.sh already
 * knows the connection is broken, because that is the other thing an empty reading means.
 */
describe("the destination the user really did empty", () => {
  it("deletes the originals on the user's word when the destination is reachable", async () => {
    await seedPair({
      approvedAt: null,
      copiesMissingObservedAt: minutesAgo(1),
      lastHealthyReadAt: minutesAgo(9),
      writeBackStateReason: COPIES_MISSING,
    });

    await resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "apply_empty_destination",
    );

    const pair = await readPair();
    expect(pair.deleteConfirmationApprovedAt).toBeInstanceOf(Date);
    expect(pair.writeBackState).toBe("ok");
  });

  it("refuses it while the destination account is waiting to be signed in again", async () => {
    await client.query(
      `update calendar_accounts set "needsReauthentication" = true where "id" = $1`,
      [accountId],
    );
    await seedPair({
      approvedAt: null,
      copiesMissingObservedAt: minutesAgo(1),
      lastHealthyReadAt: minutesAgo(9),
      writeBackStateReason: COPIES_MISSING,
    });

    await expect(resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "apply_empty_destination",
    )).rejects.toThrow();

    expect(await readPair()).toMatchObject({
      deleteConfirmationApprovedAt: null,
      writeBackState: WAITING,
    });
  });

  it("refuses it while the destination calendar is paused", async () => {
    await client.query(
      `update calendars set "disabled" = true where "id" = $1`,
      [destinationCalendarId],
    );
    await seedPair({
      approvedAt: null,
      copiesMissingObservedAt: minutesAgo(1),
      lastHealthyReadAt: minutesAgo(9),
      writeBackStateReason: COPIES_MISSING,
    });

    await expect(resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "apply_empty_destination",
    )).rejects.toThrow();

    expect(await readPair()).toMatchObject({
      deleteConfirmationApprovedAt: null,
      writeBackState: WAITING,
    });
  });

  it("refuses it for a pair held on something other than an empty reading", async () => {
    await seedPair({
      approvedAt: null,
      copiesMissingObservedAt: null,
      lastHealthyReadAt: minutesAgo(1),
      writeBackStateReason: "delete_probe_blocked",
    });

    await expect(resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "apply_empty_destination",
    )).rejects.toThrow();

    expect(await readPair()).toMatchObject({
      deleteConfirmationApprovedAt: null,
      writeBackState: WAITING,
    });
  });
});
