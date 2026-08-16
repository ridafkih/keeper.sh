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

const { sourceSupportsWriteBack } = await import(
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
  "capabilities" text[] not null default '{pull}',
  "disabled" boolean not null default false,
  "userId" text not null
);
`;

const insertCalendar = async (
  calendarType: string,
  capabilities: string[],
): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `insert into calendars ("calendarType", "capabilities", "userId")
     values ($1, $2, $3) returning "id"`,
    [calendarType, capabilities, USER_ID],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to seed a calendar");
  }
  return id;
};

beforeEach(async () => {
  await client.exec(`drop table if exists calendars cascade;`);
  await client.exec(`drop table if exists calendar_accounts cascade;`);
  await client.exec(`drop table if exists caldav_credentials cascade;`);
  await client.exec(DDL);
});

/*
 * A calendar shared with the user read-only is stored with "pull" alone. Offering two-way
 * on it walks the user through the deletion-consent modal and then rejects every write at
 * the provider, quarantining the pair for a reason Keeper.sh knew before the button was
 * pressed.
 */
describe("a source calendar the account may only read", () => {
  it("is refused two-way sync", async () => {
    const sourceCalendarId = await insertCalendar("google", ["pull"]);

    expect(await sourceSupportsWriteBack(USER_ID, sourceCalendarId)).toBe(false);
  });

  it("still admits a source the account may also write", async () => {
    const sourceCalendarId = await insertCalendar("google", ["pull", "push"]);

    expect(await sourceSupportsWriteBack(USER_ID, sourceCalendarId)).toBe(true);
  });

  it("refuses a link subscription however it is stored", async () => {
    const sourceCalendarId = await insertCalendar("ical", ["pull", "push"]);

    expect(await sourceSupportsWriteBack(USER_ID, sourceCalendarId)).toBe(false);
  });
});
