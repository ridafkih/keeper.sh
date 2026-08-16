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
  "calendarType" text not null default 'caldav',
  "capabilities" text[] not null default '{pull,push}',
  "disabled" boolean not null default false,
  "userId" text not null
);
`;

const insertCalDAVCalendar = async (username: string): Promise<string> => {
  const credential = await client.query<{ id: string }>(
    `insert into caldav_credentials ("username") values ($1) returning "id"`,
    [username],
  );
  const credentialId = credential.rows[0]?.id;
  const account = await client.query<{ id: string }>(
    `insert into calendar_accounts ("caldavCredentialId") values ($1) returning "id"`,
    [credentialId],
  );
  const accountId = account.rows[0]?.id;
  const calendar = await client.query<{ id: string }>(
    `insert into calendars ("accountId", "userId") values ($1, $2) returning "id"`,
    [accountId, USER_ID],
  );
  const id = calendar.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to seed a CalDAV calendar");
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
 * Nothing in the CalDAV connect flow asks for an email (services/api/src/utils/
 * caldav-sources.ts), so the login is the only address the account is known by — and on
 * Nextcloud, Radicale, Baikal, Synology or Zimbra it is not an address at all. The API
 * used to refuse the mode on exactly that, because the writer refused every event
 * carrying an ORGANIZER it could not place. No write is decided on who wrote the event
 * any more, so the mode has nothing left to withhold: this is where that reaches the user.
 */
describe("a CalDAV source whose account names no address", () => {
  it("is offered two-way sync when the login is a bare username", async () => {
    const sourceCalendarId = await insertCalDAVCalendar("nextcloud-admin");

    expect(await sourceSupportsWriteBack(USER_ID, sourceCalendarId)).toBe(true);
  });

  it("is offered two-way sync when the login is an address", async () => {
    const sourceCalendarId = await insertCalDAVCalendar("me@fastmail.com");

    expect(await sourceSupportsWriteBack(USER_ID, sourceCalendarId)).toBe(true);
  });
});
