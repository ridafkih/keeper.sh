import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { isWriteBackCapableSource } from "@keeper.sh/data-schemas";
import { beforeAll, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

vi.mock("@/context", () => ({
  database,
  premiumService: {
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

const { importOAuthAccountCalendars } = await import("../../src/utils/oauth-sources");

const DDL = `
create table "user" ("id" text primary key);

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

const USER_ID = "user-readonly-import";

beforeAll(async () => {
  await client.exec(DDL);
  await client.exec(`insert into "user" ("id") values ('${USER_ID}')`);
});

describe("importing a Google account that includes a read-only calendar", () => {
  it("does not record write capability for a calendar the account may only read", async () => {
    await importOAuthAccountCalendars({
      accessToken: "token",
      email: "person@example.com",
      oauthCredentialId: null,
      provider: "google",
      providerAccountId: "google-account-1",
      userId: USER_ID,
    } as never);

    const rows = await client.query<{
      calendarType: string;
      capabilities: string[];
      externalCalendarId: string;
    }>(
      `select "externalCalendarId", "capabilities", "calendarType" from calendars order by "externalCalendarId"`,
    );

    const reader = rows.rows.find((row) => row.externalCalendarId === "cal-reader");
    const owner = rows.rows.find((row) => row.externalCalendarId === "cal-owner");

    expect(owner).toBeDefined();
    expect(reader).toBeDefined();
    expect(isWriteBackCapableSource(owner ?? null)).toBe(true);
    expect(isWriteBackCapableSource(reader ?? null)).toBe(false);
  });
});
