import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { isWriteBackCapableSource } from "@keeper.sh/data-schemas";
import { beforeAll, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

vi.mock("@/context", () => ({
  database,
  premiumService: {
    canAddAccount: () => Promise.resolve(true),
    getAccountLimit: () => 10,
    getUserPlan: () => Promise.resolve("pro"),
  },
}));

vi.mock("@/utils/background-task", () => ({ spawnBackgroundJob: () => null }));
vi.mock("./background-task", () => ({ spawnBackgroundJob: () => null }));
vi.mock("@/utils/enqueue-push-sync", () => ({
  enqueueMappingReplacementSync: () => Promise.resolve(),
  enqueuePushSync: () => Promise.resolve(),
}));

vi.mock("@keeper.sh/calendar/google", () => ({
  listUserCalendars: () =>
    Promise.resolve([
      { accessRole: "owner", id: "cal-owner", summary: "My calendar" },
      { accessRole: "reader", id: "cal-reader", summary: "Team calendar" },
    ]),
}));

vi.mock("@keeper.sh/calendar/outlook", () => ({
  listUserCalendars: () => Promise.resolve([]),
}));

vi.mock("../../src/utils/oauth-refresh", () => ({
  refreshGoogleAccessToken: () => Promise.resolve({ accessToken: "token" }),
  refreshGoogleSourceAccessToken: () => Promise.resolve({ accessToken: "token" }),
  refreshMicrosoftAccessToken: () => Promise.resolve({ accessToken: "token" }),
  refreshMicrosoftSourceAccessToken: () => Promise.resolve({ accessToken: "token" }),
}));

const { createOAuthSource } = await import("../../src/utils/oauth-sources");

const DDL = `
create table "user" ("id" text primary key);

create table oauth_credentials (
  "id" uuid primary key default gen_random_uuid(),
  "accessToken" text not null,
  "email" text,
  "expiresAt" timestamp not null,
  "provider" text not null,
  "refreshToken" text not null,
  "userId" text not null,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);

create table calendar_accounts (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" text,
  "authType" text not null,
  "displayName" text,
  "email" text,
  "oauthCredentialId" uuid,
  "provider" text not null,
  "userId" text not null,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now(),
  "needsReauthentication" boolean not null default false,
  "caldavCredentialId" uuid,
  "calendarsRefreshAttemptedAt" timestamp,
  "calendarsRefreshedAt" timestamp,
  "reauthenticationSource" text
);

create table calendars (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" uuid not null,
  "calendarType" text not null,
  "calendarUrl" text,
  "capabilities" text[] not null default '{pull}',
  "customEventName" text not null default '{{calendar_name}}',
  "disabled" boolean not null default false,
  "excludeAllDayEvents" boolean not null default false,
  "excludeEventDescription" boolean not null default true,
  "excludeEventLocation" boolean not null default true,
  "excludeEventName" boolean not null default true,
  "excludeFocusTime" boolean not null default false,
  "excludeOutOfOffice" boolean not null default false,
  "externalCalendarId" text,
  "failureCount" integer not null default 0,
  "includeInIcalFeed" boolean not null default false,
  "ingestFailureCount" integer not null default 0,
  "ingestFutureRange" text not null default '1_year',
  "ingestHistoricRange" text not null default '1_month',
  "ingestLastFailureAt" timestamp,
  "ingestNextAttemptAt" timestamp,
  "ingestWindowEnd" timestamp,
  "ingestWindowRecordedAt" timestamp,
  "ingestLastSucceededAt" timestamp,
  "ingestWindowStart" timestamp,
  "lastFailureAt" timestamp,
  "name" text not null,
  "nextAttemptAt" timestamp,
  "originalName" text,
  "syncFutureRange" text not null default '1_year',
  "syncHistoricRange" text not null default '1_month',
  "syncToken" text,
  "treatFullDayTimedEventsAsAllDay" boolean not null default false,
  "unavailableSince" timestamp,
  "url" text,
  "userId" text not null,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);

create table ical_feeds (
  "id" uuid primary key default gen_random_uuid(),
  "userId" text not null,
  "name" text not null default 'Keeper.sh',
  "token" text not null,
  "isDefault" boolean not null default false,
  "legacyAlias" boolean not null default false,
  "includeEventName" boolean not null default true,
  "includeEventDescription" boolean not null default false,
  "includeEventLocation" boolean not null default false,
  "excludeAllDayEvents" boolean not null default false,
  "excludeFocusTime" boolean not null default false,
  "excludeOutOfOffice" boolean not null default false,
  "customEventName" text not null default '{{calendar_name}}',
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);

create unique index ical_feeds_default_idx on ical_feeds ("userId") where "isDefault" = true;

create table ical_feed_calendars (
  "id" uuid primary key default gen_random_uuid(),
  "feedId" uuid not null,
  "calendarId" uuid not null,
  "createdAt" timestamp not null default now()
);
`;

const USER_ID = "user-single-source";
let credentialId = "";

const readCalendar = async (externalCalendarId: string) => {
  const rows = await client.query<{ calendarType: string; capabilities: string[] }>(
    `select "calendarType", "capabilities" from calendars where "externalCalendarId" = $1`,
    [externalCalendarId],
  );
  return rows.rows[0] ?? null;
};

beforeAll(async () => {
  await client.exec(DDL);
  await client.exec(`insert into "user" ("id") values ('${USER_ID}')`);
  const inserted = await client.query<{ id: string }>(
    `insert into oauth_credentials
       ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('token', 'person@example.com', now() + interval '1 hour', 'google', 'refresh', $1)
     returning "id"`,
    [USER_ID],
  );
  credentialId = inserted.rows[0]?.id ?? "";
});

describe("adding one Google calendar as a source", () => {
  it("records a calendar the account owns as one that can receive edits", async () => {
    await createOAuthSource({
      externalCalendarId: "cal-owner",
      name: "My calendar",
      oauthCredentialId: credentialId,
      provider: "google",
      userId: USER_ID,
    });

    expect(isWriteBackCapableSource(await readCalendar("cal-owner"))).toBe(true);
  });

  it("records a calendar shared read-only as one that cannot", async () => {
    await createOAuthSource({
      externalCalendarId: "cal-reader",
      name: "Team calendar",
      oauthCredentialId: credentialId,
      provider: "google",
      userId: USER_ID,
    });

    expect(isWriteBackCapableSource(await readCalendar("cal-reader"))).toBe(false);
  });

  /*
   * A listing that could not be read says nothing about the calendar, and the gate that
   * reads this column offers the user a promise Keeper.sh would then break. The refusing
   * answer is the one that costs nothing: rediscovery restates it on the next pass.
   */
  it("records a calendar it could not ask about as one that cannot", async () => {
    const calendar = await import("@keeper.sh/calendar/google");
    const listing = vi.spyOn(calendar, "listUserCalendars")
      .mockRejectedValue(new Error("Failed to list calendars: 503"));

    await createOAuthSource({
      externalCalendarId: "cal-owner-2",
      name: "Another calendar",
      oauthCredentialId: credentialId,
      provider: "google",
      userId: USER_ID,
    });

    expect(isWriteBackCapableSource(await readCalendar("cal-owner-2"))).toBe(false);
    listing.mockRestore();
  });
});
