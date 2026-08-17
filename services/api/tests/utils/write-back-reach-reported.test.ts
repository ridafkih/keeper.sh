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

const { getWriteBackStatesForSource, setWriteBackReach } = await import(
  "../../src/utils/source-destination-mappings"
);

const USER_ID = "user-1";

const DDL = `
create table calendar_accounts (
  "id" uuid primary key default gen_random_uuid(),
  "email" text
);
create table calendars (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" uuid,
  "calendarType" text not null default 'google',
  "capabilities" text[] not null default '{pull,push}',
  "disabled" boolean not null default false,
  "ingestLastSucceededAt" timestamptz not null default now(),
  "userId" text not null
);
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "copiesMissingObservedAt" timestamptz,
  "deleteConfirmationApprovedAt" timestamptz,
  "destinationCalendarId" uuid not null,
  "lastHealthyReadAt" timestamptz,
  "writeBackReach" text not null default 'own_events',
  "sourceCalendarId" uuid not null,
  "writeBackMode" text not null default 'edits',
  "writeBackState" text not null default 'ok',
  "writeBackStateReason" text
);
`;

const insertCalendar = async (): Promise<string> => {
  const calendar = await client.query<{ id: string }>(
    `insert into calendars ("userId") values ($1) returning "id"`,
    [USER_ID],
  );
  const id = calendar.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to seed a calendar");
  }
  return id;
};

const seedPair = async (writeBackState = "ok"): Promise<{
  destinationCalendarId: string;
  sourceCalendarId: string;
}> => {
  const sourceCalendarId = await insertCalendar();
  const destinationCalendarId = await insertCalendar();
  await client.query(
    `insert into source_destination_mappings
       ("sourceCalendarId", "destinationCalendarId", "writeBackState", "writeBackStateReason")
     values ($1, $2, $3, $4)`,
    [sourceCalendarId, destinationCalendarId, writeBackState, "shared_event"],
  );
  return { destinationCalendarId, sourceCalendarId };
};

beforeEach(async () => {
  await client.exec(`drop table if exists source_destination_mappings cascade;`);
  await client.exec(`drop table if exists calendars cascade;`);
  await client.exec(`drop table if exists calendar_accounts cascade;`);
  await client.exec(DDL);
});

/*
 * The dashboard cannot render a permission it is never told about. Without this the control
 * sits unchecked whatever the user answered, and the answer they gave last week reads as one
 * they never gave.
 */
describe("how far a write may reach is reported to the dashboard", () => {
  it("reports the narrowest level until the user picks another", async () => {
    const { destinationCalendarId, sourceCalendarId } = await seedPair();

    const states = await getWriteBackStatesForSource(USER_ID, sourceCalendarId);

    expect(states[destinationCalendarId]?.writeBackReach).toBe("own_events");
  });

  it("reports every level the user can pick, and releases the hold it answers", async () => {
    for (const level of ["my_meetings", "my_meetings_notifying", "any_event"]) {
      const { destinationCalendarId, sourceCalendarId } = await seedPair("grant_required");

      await setWriteBackReach(USER_ID, sourceCalendarId, destinationCalendarId, level);
      const states = await getWriteBackStatesForSource(USER_ID, sourceCalendarId);

      expect(states[destinationCalendarId]?.writeBackReach).toBe(level);
      expect(states[destinationCalendarId]?.state).toBe("ok");
    }
  });

  it("narrows back to the default without touching a quarantine", async () => {
    const { destinationCalendarId, sourceCalendarId } = await seedPair("quarantined");
    await setWriteBackReach(USER_ID, sourceCalendarId, destinationCalendarId, "any_event");

    await setWriteBackReach(USER_ID, sourceCalendarId, destinationCalendarId, "own_events");
    const states = await getWriteBackStatesForSource(USER_ID, sourceCalendarId);

    expect(states[destinationCalendarId]?.writeBackReach).toBe("own_events");
    expect(states[destinationCalendarId]?.state).toBe("quarantined");
  });
});
