import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabaseWriteBackStore } from "../src/write-back";
import type { WriteBackApplierConfig } from "../src/write-back";

/*
 * A source write is made from inside the source lock's transaction, and the token it is
 * made with used to be refreshed lazily: an expiring credential turned the first provider
 * call into a credential update on the pool while the lock's own connection was still
 * held. One write then needs two connections at once, and enough of them at once hold
 * every connection the process has while each waits for one no other can give back.
 */
const DESTINATION_CALENDAR_ID = "22222222-2222-4222-8222-222222222222";
const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const DEADLINE_MS = 8000;
const DEADLINE_MULTIPLE = 3;
const SINGLE_CONNECTION = 1;
const SETUP_CONNECTIONS = 2;
const REFRESHED_TOKEN_LIFETIME_SECONDS = 3600;

/*
 * Its own schema, so that a suite running this file beside another that builds the same
 * tables cannot drop them out from under it.
 */
const TEST_SCHEMA = "write_back_token_refresh";
const scopedUrl = `${administrativeUrl}?options=-c%20search_path%3D${TEST_SCHEMA}`;

const DDL = `
drop table if exists calendars cascade;
drop table if exists calendar_accounts cascade;
drop table if exists oauth_credentials cascade;

create table oauth_credentials (
  "id" uuid primary key default gen_random_uuid(),
  "accessToken" text not null,
  "refreshToken" text not null,
  "expiresAt" timestamptz not null,
  "provider" text not null,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null
);

create table calendar_accounts (
  "id" uuid primary key default gen_random_uuid(),
  "email" text,
  "oauthCredentialId" uuid,
  "provider" text not null,
  "authType" text not null default 'oauth',
  "needsReauthentication" boolean not null default false,
  "reauthenticationSource" text,
  "userId" text not null
);

create table calendars (
  "id" uuid primary key,
  "accountId" uuid not null,
  "calendarType" text not null default 'google',
  "externalCalendarId" text,
  "disabled" boolean not null default false,
  "ingestLastSucceededAt" timestamptz
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

const SOURCE_ID = "33333333-1111-4111-8111-111111111111";
const CREDENTIAL_ID = "44444444-1111-4111-8111-111111111111";
const ACCOUNT_ID = "55555555-1111-4111-8111-111111111111";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

let client: SQL | null = null;

const seed = async (): Promise<void> => {
  const administrator = new SQL({
    max: SINGLE_CONNECTION,
    prepare: false,
    url: administrativeUrl,
  });
  await administrator.unsafe(`create schema if not exists ${TEST_SCHEMA}`);
  await administrator.end();

  const setup = new SQL({ max: SETUP_CONNECTIONS, prepare: false, url: scopedUrl });
  await setup.unsafe(DDL);
  await setup.unsafe(
    `insert into oauth_credentials
       ("id","accessToken","refreshToken","expiresAt","provider","userId")
     values ($1, 'stale-token', 'refresh-token', now() - interval '1 hour', 'google', 'user-1')`,
    [CREDENTIAL_ID],
  );
  await setup.unsafe(
    `insert into calendar_accounts ("id","email","oauthCredentialId","provider","userId")
     values ($1, 'me@example.com', $2, 'google', 'user-1')`,
    [ACCOUNT_ID, CREDENTIAL_ID],
  );
  await setup.unsafe(
    `insert into calendars ("id","accountId","externalCalendarId") values ($1,$2,'primary')`,
    [SOURCE_ID, ACCOUNT_ID],
  );
  await setup.end();
};

beforeAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await seed();
  client = new SQL({ max: SINGLE_CONNECTION, prepare: false, url: scopedUrl });
});

afterAll(async () => {
  await client?.close({ timeout: 0 });
});

describe.skipIf(!administrativeUrl)(
  "a source write whose access token has to be refreshed",
  () => {
    it("finishes on one connection, refreshing before the lock is taken", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", (input: unknown) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("oauth2")) {
          return Promise.resolve(Response.json({
            access_token: "fresh-token",
            expires_in: REFRESHED_TOKEN_LIFETIME_SECONDS,
            scope: "https://www.googleapis.com/auth/calendar",
            token_type: "Bearer",
          }));
        }
        if (url.includes("/events/")) {
          return Promise.resolve(Response.json({
            creator: { email: "me@example.com", self: true },
            id: "source-event",
            organizer: { email: "me@example.com", self: true },
          }));
        }
        return Promise.resolve(Response.json({}));
      });

      const database = drizzle({ client: client as SQL }) as unknown as BunSQLDatabase;
      const store = createDatabaseWriteBackStore({
        database,
        oauthConfig: { googleClientId: "id", googleClientSecret: "secret" },
        refreshLockStore: null,
        userId: "user-1",
      } as unknown as WriteBackApplierConfig);

      const writer = await store.resolveWriter(SOURCE_ID, DESTINATION_CALENDAR_ID);
      expect(writer).not.toBeNull();

      const outcome = await Promise.race([
        store.withSourceLock(SOURCE_ID, () =>
          (writer as NonNullable<typeof writer>).deleteEvent({
            sourceEventId: "source-event",
            sourceEventUid: "source-event",
          })),
        new Promise<"stalled">((resolve) => {
          setTimeout(() => { resolve("stalled"); }, DEADLINE_MS);
        }),
      ]);

      expect(outcome).not.toBe("stalled");
      expect(outcome).toEqual({ success: true });
      expect(calls[0]).toBe(TOKEN_ENDPOINT);
    }, DEADLINE_MS * DEADLINE_MULTIPLE);
  },
);
