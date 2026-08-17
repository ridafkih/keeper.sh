import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createDatabaseWriteBackStore } from "../src/write-back";
import type { WriteBackApplierConfig } from "../src/write-back";

/*
 * The refusal that keeps a colleague's events out of a mirror's reach is decided by
 * comparing the event's author against the address the account is signed in as. Every test
 * of that refusal builds its writer by hand and hands it the address, so none of them can
 * see whether production ever reads it out of the database and passes it on. Nulling the
 * two `accountEmail` lines in resolveOAuthSourceWriter leaves the whole sync suite green
 * while the refusal goes inert and the colleague's calendar becomes writable again.
 */
const client = new PGlite();
const database = drizzle(client);

const DESTINATION_CALENDAR_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_CALENDAR_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const CREDENTIAL_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_EMAIL = "me@example.com";
const COLLEAGUE_EMAIL = "colleague@example.com";
const SHARED_CALENDAR = "colleague@example.com";
const SOURCE_EVENT_UID = "studio-booking-uid";
const OK = 200;
const HOUR_MS = 3_600_000;

const DDL = `
create table oauth_credentials (
  "id" uuid primary key,
  "accessToken" text not null,
  "refreshToken" text not null,
  "expiresAt" timestamptz not null
);
create table calendar_accounts (
  "id" uuid primary key,
  "email" text,
  "provider" text not null,
  "oauthCredentialId" uuid,
  "caldavCredentialId" uuid
);
create table calendars (
  "id" uuid primary key,
  "accountId" uuid not null,
  "externalCalendarId" text not null,
  "calendarUrl" text
);
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "sourceCalendarId" uuid not null,
  "destinationCalendarId" uuid not null,
  "writeBackMode" text not null default 'edits',
  "writeBackReach" text not null default 'own_events',
  "writeBackState" text not null default 'ok'
);
`;

/*
 * A team calendar a colleague shared with "Make changes to events": Google grants the
 * write, the event is theirs, and nobody is invited, so nothing about the guest list stops
 * a mirror from destroying it. Google reports `creator.self` true because `self` means the
 * creator is the calendar this copy sits on — and here the creator IS the calendar.
 */
const COLLEAGUES_EVENT = {
  creator: { email: COLLEAGUE_EMAIL, self: true },
  iCalUID: SOURCE_EVENT_UID,
  id: SOURCE_EVENT_UID,
  organizer: { email: COLLEAGUE_EMAIL, self: true },
  summary: "Studio booked",
};

const store = createDatabaseWriteBackStore({
  database: database as unknown as BunSQLDatabase,
  oauthConfig: {
    googleClientId: "client-id",
    googleClientSecret: "client-secret",
  },
} as unknown as WriteBackApplierConfig);

const seed = async (email: string | null, reach = "own_events"): Promise<void> => {
  await client.query(`delete from source_destination_mappings`);
  await client.query(`delete from calendars`);
  await client.query(`delete from calendar_accounts`);
  await client.query(`delete from oauth_credentials`);
  await client.query(
    `insert into source_destination_mappings
       ("sourceCalendarId", "destinationCalendarId", "writeBackReach")
     values ($1, $2, $3)`,
    [SOURCE_CALENDAR_ID, DESTINATION_CALENDAR_ID, reach],
  );
  await client.query(
    `insert into oauth_credentials ("id", "accessToken", "refreshToken", "expiresAt")
     values ($1, 'token', 'refresh', $2)`,
    [CREDENTIAL_ID, new Date(Date.now() + HOUR_MS).toISOString()],
  );
  await client.query(
    `insert into calendar_accounts ("id", "email", "provider", "oauthCredentialId")
     values ($1, $2, 'google', $3)`,
    [ACCOUNT_ID, email, CREDENTIAL_ID],
  );
  await client.query(
    `insert into calendars ("id", "accountId", "externalCalendarId")
     values ($1, $2, $3)`,
    [SOURCE_CALENDAR_ID, ACCOUNT_ID, SHARED_CALENDAR],
  );
};

const recordProviderCalls = (): string[] => {
  const methods: string[] = [];
  globalThis.fetch = vi.fn((_input: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return Promise.resolve(Response.json(COLLEAGUES_EVENT, { status: OK }));
    }
    methods.push(method);
    return Promise.resolve(new Response("{}", { status: OK }));
  }) as unknown as typeof fetch;
  return methods;
};

beforeEach(async () => {
  await client.query(`drop table if exists source_destination_mappings`);
  await client.query(`drop table if exists calendars`);
  await client.query(`drop table if exists calendar_accounts`);
  await client.query(`drop table if exists oauth_credentials`);
  await client.exec(DDL);
});

describe("the identity a production source writer is built with", () => {
  it("refuses to rewrite an event a colleague put on the calendar they shared", async () => {
    await seed(ACCOUNT_EMAIL);
    const methods = recordProviderCalls();

    const writer = await store.resolveWriter(SOURCE_CALENDAR_ID, DESTINATION_CALENDAR_ID);
    if (!writer) {
      throw new Error("The store built no writer for the source calendar");
    }
    const result = await writer.updateEvent(
      { sourceEventId: SOURCE_EVENT_UID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(methods).toEqual([]);
    expect(result.refused).toBe("event_authored_by_someone_else");
    expect(result.success).toBe(false);
  });

  /*
   * The reach the user picked has to travel from the pair row to the writer, and nothing
   * about the guard itself proves that it does: a writer built with the default refuses a
   * meeting exactly as one built with a reach that was never read. This is the wiring, and
   * it is asserted against the production store rather than a hand-built writer for the
   * same reason the address above is.
   */
  it("carries the reach the pair stores into the writer it builds", async () => {
    await seed(ACCOUNT_EMAIL, "any_event");
    const methods = recordProviderCalls();

    const writer = await store.resolveWriter(SOURCE_CALENDAR_ID, DESTINATION_CALENDAR_ID);
    if (!writer) {
      throw new Error("The store built no writer for the source calendar");
    }
    const result = await writer.updateEvent(
      { sourceEventId: SOURCE_EVENT_UID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBeUndefined();
    expect(methods).not.toEqual([]);
  });

  it("refuses to delete it too", async () => {
    await seed(ACCOUNT_EMAIL);
    const methods = recordProviderCalls();

    const writer = await store.resolveWriter(SOURCE_CALENDAR_ID, DESTINATION_CALENDAR_ID);
    if (!writer) {
      throw new Error("The store built no writer for the source calendar");
    }
    const result = await writer.deleteEvent({
      sourceEventId: SOURCE_EVENT_UID,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(methods).toEqual([]);
    expect(result.refused).toBe("event_authored_by_someone_else");
    expect(result.success).toBe(false);
  });

  /*
   * The refusal is an address comparison, so an account stored without an address has
   * nothing to compare and the provider's flag is all there is. That case is deliberate and
   * unchanged; it is here so the two cases above cannot be satisfied by refusing everything.
   */
  it("still writes when the account has no address to weigh the author against", async () => {
    await seed(null);
    const methods = recordProviderCalls();

    const writer = await store.resolveWriter(SOURCE_CALENDAR_ID, DESTINATION_CALENDAR_ID);
    if (!writer) {
      throw new Error("The store built no writer for the source calendar");
    }
    const result = await writer.updateEvent(
      { sourceEventId: SOURCE_EVENT_UID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(methods).toEqual(["PATCH"]);
    expect(result.success).toBe(true);
  });
});
