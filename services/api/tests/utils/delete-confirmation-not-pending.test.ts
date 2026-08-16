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
create table calendars (
  "id" uuid primary key default gen_random_uuid(),
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
);
create table event_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "calendarId" uuid not null,
  "createdAt" timestamp not null default now(),
  "deleteIdentifier" text,
  "destinationAvailability" text,
  "destinationContentHash" text,
  "destinationDescription" text,
  "destinationEndTime" timestamp,
  "destinationEventUid" text not null default 'destination-uid',
  "destinationIsAllDay" boolean,
  "destinationLocation" text,
  "destinationStartTime" timestamp,
  "destinationSummary" text,
  "endTime" timestamp not null default now(),
  "eventStateId" uuid,
  "missingFirstObservedAt" timestamp,
  "missingObservationCount" integer not null default 0,
  "sourceCalendarId" uuid,
  "startTime" timestamp not null default now(),
  "syncEventHash" text,
  "syncEventId" text,
  "writeBackDailyCount" integer not null default 0,
  "writeBackDailyWindowStart" timestamp,
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

let sourceCalendarId = "";
let destinationCalendarId = "";

const insertCalendar = async (): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `insert into calendars ("userId") values ($1) returning "id"`,
    [USER_ID],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to seed a calendar");
  }
  return id;
};

/*
 * A reading that came back with at least one copy since they went missing is what makes
 * the deletion answerable at all, so a pair asking about copies that vanished is seeded
 * with one. Without it the approval is refused on its own account, which is the blank-read
 * gate's own test rather than this file's subject.
 */
const MISSING_OBSERVED_AT = new Date("2027-05-11T14:00:00.000Z");
const HEALTHY_READ_AT = new Date("2027-05-11T15:00:00.000Z");

const seedPair = async (state: {
  writeBackMode: string;
  writeBackState: string;
  writeBackStateReason: string | null;
}): Promise<void> => {
  await client.query(
    `insert into source_destination_mappings
       ("destinationCalendarId", "sourceCalendarId", "writeBackMode",
        "writeBackState", "writeBackStateReason",
        "copiesMissingObservedAt", "lastHealthyReadAt")
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      destinationCalendarId,
      sourceCalendarId,
      state.writeBackMode,
      state.writeBackState,
      state.writeBackStateReason,
      MISSING_OBSERVED_AT,
      HEALTHY_READ_AT,
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
      source_destination_mappings, calendars cascade;
  `);
  await client.exec(DDL);
  sourceCalendarId = await insertCalendar();
  destinationCalendarId = await insertCalendar();
});

describe("an answer is only accepted for a question the pair is actually asking", () => {
  /*
   * The approval is a half-hour exemption from the bulk-delete breaker and from the hold
   * on an ambiguous empty read. Stamping it when nothing was asked arms that exemption on
   * a healthy pair, and the next truncated listing deletes real events in bulk.
   */
  it("does not arm the delete approval when no question is pending", async () => {
    await seedPair({
      writeBackMode: "edits_and_deletes",
      writeBackState: "ok",
      writeBackStateReason: null,
    });

    await expect(resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "apply",
    )).rejects.toThrow();

    expect(await readPair()).toMatchObject({
      deleteConfirmationApprovedAt: null,
      writeBackState: "ok",
    });
  });

  it("does not lift a quarantine that stopped write-back for a different reason", async () => {
    await seedPair({
      writeBackMode: "edits_and_deletes",
      writeBackState: "quarantined",
      writeBackStateReason: "source_event_has_attendees",
    });

    await expect(resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "apply",
    )).rejects.toThrow();

    expect(await readPair()).toMatchObject({
      deleteConfirmationApprovedAt: null,
      writeBackState: "quarantined",
      writeBackStateReason: "source_event_has_attendees",
    });
  });

  it("does not lift a quarantine when the copies are put back instead", async () => {
    await seedPair({
      writeBackMode: "edits_and_deletes",
      writeBackState: "quarantined",
      writeBackStateReason: "runaway_write_back",
    });

    await resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "decline",
    );

    expect(await readPair()).toMatchObject({
      deleteConfirmationApprovedAt: null,
      writeBackState: "quarantined",
      writeBackStateReason: "runaway_write_back",
    });
  });

  it("still records the answer the pair is waiting for", async () => {
    await seedPair({
      writeBackMode: "edits_and_deletes",
      writeBackState: "delete_confirmation_required",
      writeBackStateReason: "all_copies_missing",
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
    expect(pair.writeBackStateReason).toBeNull();
  });

  it("still puts the copies back for the pair that asked", async () => {
    await seedPair({
      writeBackMode: "edits_and_deletes",
      writeBackState: "delete_confirmation_required",
      writeBackStateReason: "all_copies_missing",
    });

    await resolveDeleteConfirmation(
      USER_ID,
      sourceCalendarId,
      destinationCalendarId,
      "decline",
    );

    expect(await readPair()).toMatchObject({
      deleteConfirmationApprovedAt: null,
      writeBackState: "ok",
      writeBackStateReason: null,
    });
  });
});
