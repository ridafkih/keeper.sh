import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RecurrenceMaterializationLimitError } from "@keeper.sh/calendar";
import {
  handleGetEventRoute,
  handleGetEventsInRangeRoute,
} from "../../src/handlers/event-routes";
import { createKeeperApi } from "../../src/read-models";
import { eventPatchBodySchema } from "../../src/utils/request-body";
import type { EventInput, EventUpdateInput, KeeperDatabase, KeeperEvent } from "../../src/types";

vi.mock("../../src/env", () => ({
  default: { ENCRYPTION_KEY: "test-key" },
}));

const SERIES_ID = "019c0000-0000-7000-8000-000000000001";
const SERIES_UID = "pathological-series-1";
const OCCURRENCE_BUDGET = 10_000;

const createLimitError = (): RecurrenceMaterializationLimitError =>
  new RecurrenceMaterializationLimitError(
    {
      calendarId: "calendar-1",
      eventId: SERIES_ID,
      sourceEventUid: SERIES_UID,
    },
    OCCURRENCE_BUDGET,
  );

const readError = async (response: Response): Promise<string | null> => {
  const body = await response.json() as { error: string | null };
  return body.error;
};

describe("handleGetEventsInRangeRoute", () => {
  it("returns the events for a valid range", async () => {
    const event = { id: SERIES_ID, title: "Standup" } as KeeperEvent;

    const response = await handleGetEventsInRangeRoute(
      new Request("https://api.test/api/events?from=2026-03-01&to=2026-03-08"),
      "user-1",
      { getEventsInRange: () => Promise.resolve([event]) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([event]);
  });

  it("passes the viewer timezone to the range read", async () => {
    const ranges: unknown[] = [];

    await handleGetEventsInRangeRoute(
      new Request("https://api.test/api/events?from=2026-03-01&to=2026-03-08&timezone=Pacific/Auckland"),
      "user-1",
      {
        getEventsInRange: (_userId, range) => {
          ranges.push(range);
          return Promise.resolve([]);
        },
      },
    );

    expect(ranges).toEqual([expect.objectContaining({ timeZone: "Pacific/Auckland" })]);
  });

  it("returns 400 for a timezone that is not an IANA identifier", async () => {
    const response = await handleGetEventsInRangeRoute(
      new Request("https://api.test/api/events?from=2026-03-01&to=2026-03-08&timezone=Nowhere/Land"),
      "user-1",
      { getEventsInRange: () => Promise.resolve([]) },
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when a series exceeds the recurrence budget", async () => {
    const response = await handleGetEventsInRangeRoute(
      new Request("https://api.test/api/events?from=2026-03-01&to=2026-03-08"),
      "user-1",
      { getEventsInRange: () => Promise.reject(createLimitError()) },
    );

    expect(response.status).toBe(400);
    expect(await readError(response)).toContain(SERIES_UID);
  });

  it("returns 400 when the requested range is invalid", async () => {
    const response = await handleGetEventsInRangeRoute(
      new Request("https://api.test/api/events?from=2026-03-08&to=2026-03-01"),
      "user-1",
      { getEventsInRange: () => Promise.reject(new Error("must not be called")) },
    );

    expect(response.status).toBe(400);
  });

  it("rethrows unrelated failures", async () => {
    await expect(handleGetEventsInRangeRoute(
      new Request("https://api.test/api/events?from=2026-03-01&to=2026-03-08"),
      "user-1",
      { getEventsInRange: () => Promise.reject(new Error("database is down")) },
    )).rejects.toThrow("database is down");
  });
});

describe("handleGetEventRoute", () => {
  it("returns the event when it exists", async () => {
    const event = { id: SERIES_ID, title: "Standup" } as KeeperEvent;

    const response = await handleGetEventRoute(SERIES_ID, "user-1", {
      getEvent: () => Promise.resolve(event),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(event);
  });

  it("returns 404 when the event is missing", async () => {
    const response = await handleGetEventRoute(SERIES_ID, "user-1", {
      getEvent: () => Promise.resolve(null),
    });

    expect(response.status).toBe(404);
  });

  it("returns 400 when the event id is absent", async () => {
    const response = await handleGetEventRoute(null, "user-1", {
      getEvent: () => Promise.reject(new Error("must not be called")),
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when the series exceeds the recurrence budget", async () => {
    const response = await handleGetEventRoute(SERIES_ID, "user-1", {
      getEvent: () => Promise.reject(createLimitError()),
    });

    expect(response.status).toBe(400);
    expect(await readError(response)).toContain(SERIES_UID);
  });

  it("rethrows unrelated failures", async () => {
    await expect(handleGetEventRoute(SERIES_ID, "user-1", {
      getEvent: () => Promise.reject(new Error("database is down")),
    })).rejects.toThrow("database is down");
  });
});

const WRITE_USER_ID = "user-api-time";
const GOOGLE_ACCOUNT_ID = "00000000-0000-4000-8000-0000000000a1";
const GOOGLE_CREDENTIAL_ID = "00000000-0000-4000-8000-0000000000b1";
const GOOGLE_CALENDAR_ID = "00000000-0000-4000-8000-0000000000c1";
const OUTLOOK_ACCOUNT_ID = "00000000-0000-4000-8000-0000000000a2";
const OUTLOOK_CREDENTIAL_ID = "00000000-0000-4000-8000-0000000000b2";
const OUTLOOK_CALENDAR_ID = "00000000-0000-4000-8000-0000000000c2";
const TIMED_EVENT_ID = "00000000-0000-4000-8000-0000000000e1";
const ALL_DAY_EVENT_ID = "00000000-0000-4000-8000-0000000000e2";
const TIMED_EVENT_UID = "timed-event@google.com";
const ALL_DAY_EVENT_UID = "all-day-event@google.com";
const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;

const WRITE_DDL = `
create table oauth_credentials (
  "id" uuid primary key,
  "accessToken" text not null,
  "refreshToken" text not null,
  "expiresAt" timestamptz not null,
  "updatedAt" timestamptz not null default now()
);
create table caldav_credentials (
  "id" uuid primary key,
  "authMethod" text not null default 'basic',
  "serverUrl" text not null,
  "username" text not null,
  "encryptedPassword" text not null
);
create table calendar_accounts (
  "id" uuid primary key,
  "provider" text not null,
  "email" text,
  "needsReauthentication" boolean not null default false,
  "oauthCredentialId" uuid,
  "caldavCredentialId" uuid,
  "userId" text not null,
  "updatedAt" timestamptz not null default now()
);
create table calendars (
  "id" uuid primary key,
  "color" text,
  "accountId" uuid not null,
  "userId" text not null,
  "name" text not null,
  "url" text,
  "calendarUrl" text,
  "externalCalendarId" text,
  "calendarType" text not null default 'source',
  "capabilities" text[] not null default '{"pull","push"}',
  "updatedAt" timestamptz not null default now()
);
create table event_states (
  "id" uuid primary key default gen_random_uuid(),
  "color" text,
  "calendarId" uuid not null,
  "availability" text,
  "description" text,
  "endTime" timestamptz not null,
  "exceptionDates" text,
  "isAllDay" boolean,
  "location" text,
  "recurrenceId" timestamptz,
  "recurrenceRule" text,
  "sourceEventId" text,
  "sourceEventType" text,
  "sourceEventUid" text,
  "startTime" timestamptz not null,
  "startTimeZone" text,
  "title" text,
  "createdAt" timestamptz not null default now()
);
create table user_events (
  "id" uuid primary key default gen_random_uuid(),
  "calendarId" uuid not null,
  "userId" text not null,
  "sourceEventUid" text,
  "title" text,
  "description" text,
  "location" text,
  "availability" text,
  "isAllDay" boolean,
  "startTime" timestamptz not null,
  "endTime" timestamptz not null,
  "startTimeZone" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
`;

const writeClient = new PGlite();
const writeDatabase = drizzle(writeClient) as unknown as KeeperDatabase;
const keeperApi = createKeeperApi(writeDatabase);

interface ProviderCall {
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  method: string;
  url: string;
}

interface StoredRow {
  endTime: string;
  isAllDay: boolean | null;
  startTime: string;
  startTimeZone: string | null;
}

interface GoogleFixture {
  allDay: boolean;
  id: string;
}

const GOOGLE_EVENTS_BY_UID = new Map<string, GoogleFixture>([
  [TIMED_EVENT_UID, { allDay: false, id: "google-timed" }],
  [ALL_DAY_EVENT_UID, { allDay: true, id: "google-all-day" }],
]);

const providerCalls: ProviderCall[] = [];

const toHeaderRecord = (headers: RequestInit["headers"]): Record<string, string> =>
  Object.fromEntries(new Headers(headers).entries());

const readGoogleStart = (fixture: GoogleFixture): Record<string, string> => {
  if (fixture.allDay) {
    return { date: "2026-11-07" };
  }
  return { dateTime: "2026-11-05T14:00:00Z" };
};

const parseSentBody = (rawBody: RequestInit["body"]): Record<string, unknown> | null => {
  if (typeof rawBody !== "string") {
    return null;
  }
  return JSON.parse(rawBody) as Record<string, unknown>;
};

const answerGoogle = (url: URL, method: string): Response => {
  if (method === "POST") {
    return Response.json({ iCalUID: "created@google.com", id: "google-created" });
  }
  if (method === "GET") {
    const fixture = GOOGLE_EVENTS_BY_UID.get(url.searchParams.get("iCalUID") ?? "");
    if (!fixture) {
      return Response.json({ items: [] });
    }
    return Response.json({
      items: [{ iCalUID: url.searchParams.get("iCalUID"), id: fixture.id, start: readGoogleStart(fixture) }],
    });
  }
  return Response.json({ id: "google-patched" });
};

const answerOutlook = (method: string): Response => {
  if (method === "POST") {
    return Response.json({ iCalUId: "created-outlook", id: "outlook-created" });
  }
  return Response.json({ id: "outlook-patched" });
};

const providerFetch = vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  providerCalls.push({
    body: parseSentBody(init?.body),
    headers: toHeaderRecord(init?.headers),
    method,
    url: url.toString(),
  });
  if (url.hostname === "www.googleapis.com") {
    return Promise.resolve(answerGoogle(url, method));
  }
  if (url.hostname === "graph.microsoft.com") {
    return Promise.resolve(answerOutlook(method));
  }
  return Promise.reject(new Error(`Unexpected provider request: ${url.toString()}`));
});

const writesTo = (method: string): ProviderCall[] =>
  providerCalls.filter((call) => call.method === method);

const readDateField = (body: Record<string, unknown> | null, field: "end" | "start"): Record<string, string> =>
  (body?.[field] ?? {}) as Record<string, string>;

const toIso = (value: unknown): string => {
  const instant = new Date(value as string | Date);
  if (Number.isNaN(instant.getTime())) {
    return `not an instant: ${String(value)}`;
  }
  return instant.toISOString();
};

const readStoredRow = async (eventId: string): Promise<StoredRow> => {
  const { rows } = await writeClient.query<{
    endTime: Date;
    isAllDay: boolean | null;
    startTime: Date;
    startTimeZone: string | null;
  }>(
    `select "startTime", "endTime", "startTimeZone", "isAllDay" from user_events where "id" = $1`,
    [eventId],
  );
  const [row] = rows;
  if (!row) {
    throw new Error(`No stored row for ${eventId}`);
  }
  return {
    endTime: toIso(row.endTime),
    isAllDay: row.isAllDay,
    startTime: toIso(row.startTime),
    startTimeZone: row.startTimeZone,
  };
};

const readCreatedRows = async (): Promise<StoredRow[]> => {
  const { rows } = await writeClient.query<{ id: string }>(
    `select "id" from user_events where "id" not in ($1, $2)`,
    [TIMED_EVENT_ID, ALL_DAY_EVENT_ID],
  );
  return Promise.all(rows.map((row) => readStoredRow(row.id)));
};

const seedStoredEvents = async (): Promise<void> => {
  await writeClient.query(`delete from user_events`);
  await writeClient.query(
    `insert into user_events ("id", "calendarId", "userId", "sourceEventUid", "title", "availability", "isAllDay", "startTime", "endTime", "startTimeZone")
     values ($1, $2, $3, $4, 'Timed', 'busy', false, '2026-11-05T14:00:00Z', '2026-11-05T15:00:00Z', 'America/Toronto'),
            ($5, $2, $3, $6, 'All day', 'busy', true, '2026-11-07T00:00:00Z', '2026-11-08T00:00:00Z', null)`,
    [TIMED_EVENT_ID, GOOGLE_CALENDAR_ID, WRITE_USER_ID, TIMED_EVENT_UID, ALL_DAY_EVENT_ID, ALL_DAY_EVENT_UID],
  );
};

const googleInput = (overrides: Partial<EventInput>): EventInput => ({
  calendarId: GOOGLE_CALENDAR_ID,
  endTime: "2026-11-05T10:00:00",
  startTime: "2026-11-05T09:00:00",
  title: "Standup",
  ...overrides,
});

const routePatchUpdates = (body: Record<string, unknown>): EventUpdateInput => {
  const validated = eventPatchBodySchema.assert(body);
  return {
    availability: validated.availability,
    description: validated.description,
    endTime: validated.endTime,
    isAllDay: validated.isAllDay,
    location: validated.location,
    startTime: validated.startTime,
    startTimeZone: validated.timezone,
    title: validated.title,
  };
};

beforeAll(async () => {
  await writeClient.exec(WRITE_DDL);
  await writeClient.query(
    `insert into oauth_credentials ("id", "accessToken", "refreshToken", "expiresAt")
     values ($1, 'google-token', 'google-refresh', '2099-01-01T00:00:00Z'),
            ($2, 'outlook-token', 'outlook-refresh', '2099-01-01T00:00:00Z')`,
    [GOOGLE_CREDENTIAL_ID, OUTLOOK_CREDENTIAL_ID],
  );
  await writeClient.query(
    `insert into calendar_accounts ("id", "provider", "email", "oauthCredentialId", "userId")
     values ($1, 'google', 'owner@example.com', $2, $5),
            ($3, 'outlook', 'owner@example.com', $4, $5)`,
    [GOOGLE_ACCOUNT_ID, GOOGLE_CREDENTIAL_ID, OUTLOOK_ACCOUNT_ID, OUTLOOK_CREDENTIAL_ID, WRITE_USER_ID],
  );
  await writeClient.query(
    `insert into calendars ("id", "accountId", "userId", "name", "externalCalendarId")
     values ($1, $2, $5, 'Google', 'primary'),
            ($3, $4, $5, 'Outlook', 'outlook-calendar')`,
    [GOOGLE_CALENDAR_ID, GOOGLE_ACCOUNT_ID, OUTLOOK_CALENDAR_ID, OUTLOOK_ACCOUNT_ID, WRITE_USER_ID],
  );
});

beforeEach(async () => {
  providerCalls.length = 0;
  providerFetch.mockClear();
  vi.stubGlobal("fetch", providerFetch);
  await seedStoredEvents();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("creating an event through the API", () => {
  it("stores and sends a wall time read in the request timezone", async () => {
    const result = await keeperApi.createEvent(
      WRITE_USER_ID,
      googleInput({ startTimeZone: "America/Edmonton" }),
    );
    const [created] = await readCreatedRows();
    const [write] = writesTo("POST");
    const sentStart = readDateField(write?.body ?? null, "start").dateTime ?? "";
    const sentEnd = readDateField(write?.body ?? null, "end").dateTime ?? "";

    expect(result.success).toBe(true);
    expect(created).toEqual({
      endTime: "2026-11-05T16:00:00.000Z",
      isAllDay: false,
      startTime: "2026-11-05T15:00:00.000Z",
      startTimeZone: "America/Edmonton",
    });
    expect({ end: toIso(sentEnd), start: toIso(sentStart) }).toEqual({
      end: "2026-11-05T16:00:00.000Z",
      start: "2026-11-05T15:00:00.000Z",
    });
    expect([EXPLICIT_OFFSET.test(sentStart), EXPLICIT_OFFSET.test(sentEnd)]).toEqual([true, true]);
  });

  it("sends Outlook the UTC instant of a wall time read in the request timezone", async () => {
    const result = await keeperApi.createEvent(
      WRITE_USER_ID,
      googleInput({ calendarId: OUTLOOK_CALENDAR_ID, startTimeZone: "America/Edmonton" }),
    );
    const [write] = writesTo("POST");

    expect(result.success).toBe(true);
    expect({
      end: readDateField(write?.body ?? null, "end"),
      start: readDateField(write?.body ?? null, "start"),
    }).toEqual({
      end: { dateTime: "2026-11-05T16:00:00.000Z", timeZone: "UTC" },
      start: { dateTime: "2026-11-05T15:00:00.000Z", timeZone: "UTC" },
    });
  });

  it("keeps an explicit offset even when a different timezone is sent", async () => {
    const result = await keeperApi.createEvent(WRITE_USER_ID, googleInput({
      endTime: "2026-11-05T10:00:00-07:00",
      startTime: "2026-11-05T09:00:00-07:00",
      startTimeZone: "America/Edmonton",
    }));
    const [created] = await readCreatedRows();

    expect(result.success).toBe(true);
    expect({ end: created?.endTime, start: created?.startTime }).toEqual({
      end: "2026-11-05T17:00:00.000Z",
      start: "2026-11-05T16:00:00.000Z",
    });
  });

  it("keeps a Z instant sent without a timezone", async () => {
    const result = await keeperApi.createEvent(WRITE_USER_ID, googleInput({
      endTime: "2026-11-05T16:00:00Z",
      startTime: "2026-11-05T15:00:00Z",
    }));
    const [created] = await readCreatedRows();

    expect(result.success).toBe(true);
    expect({ end: created?.endTime, start: created?.startTime, zone: created?.startTimeZone }).toEqual({
      end: "2026-11-05T16:00:00.000Z",
      start: "2026-11-05T15:00:00.000Z",
      zone: null,
    });
  });

  it("rejects a wall time sent without a timezone before writing anywhere", async () => {
    const result = await keeperApi.createEvent(WRITE_USER_ID, googleInput({}));

    expect(result.success).toBe(false);
    expect(String(result.error).toLowerCase()).toContain("timezone");
    expect(providerFetch).not.toHaveBeenCalled();
    expect(await readCreatedRows()).toEqual([]);
  });

  it("rejects a timezone that does not resolve before writing anywhere", async () => {
    const result = await keeperApi.createEvent(WRITE_USER_ID, googleInput({
      endTime: "2026-11-05T16:00:00Z",
      startTime: "2026-11-05T15:00:00Z",
      startTimeZone: "Mars/Olympus",
    }));

    expect(result.success).toBe(false);
    expect(String(result.error).toLowerCase()).toContain("timezone");
    expect(providerFetch).not.toHaveBeenCalled();
    expect(await readCreatedRows()).toEqual([]);
  });

  it("rejects a date on a timed event before writing anywhere", async () => {
    const result = await keeperApi.createEvent(WRITE_USER_ID, googleInput({
      endTime: "2026-11-06",
      startTime: "2026-11-05",
      startTimeZone: "America/Edmonton",
    }));

    expect(result.success).toBe(false);
    expect(providerFetch).not.toHaveBeenCalled();
    expect(await readCreatedRows()).toEqual([]);
  });

  it("stores an all-day date as that date", async () => {
    const result = await keeperApi.createEvent(WRITE_USER_ID, googleInput({
      endTime: "2026-11-06",
      isAllDay: true,
      startTime: "2026-11-05",
    }));
    const [created] = await readCreatedRows();
    const [write] = writesTo("POST");

    expect(result.success).toBe(true);
    expect({ end: created?.endTime, start: created?.startTime }).toEqual({
      end: "2026-11-06T00:00:00.000Z",
      start: "2026-11-05T00:00:00.000Z",
    });
    expect(readDateField(write?.body ?? null, "start")).toEqual({ date: "2026-11-05" });
  });

  it("stores an all-day local midnight as its calendar date", async () => {
    const result = await keeperApi.createEvent(WRITE_USER_ID, googleInput({
      endTime: "2026-11-06T00:00:00",
      isAllDay: true,
      startTime: "2026-11-05T00:00:00",
      startTimeZone: "Asia/Tokyo",
    }));
    const [created] = await readCreatedRows();
    const [write] = writesTo("POST");

    expect(result.success).toBe(true);
    expect({ end: created?.endTime, start: created?.startTime }).toEqual({
      end: "2026-11-06T00:00:00.000Z",
      start: "2026-11-05T00:00:00.000Z",
    });
    expect(readDateField(write?.body ?? null, "start")).toEqual({ date: "2026-11-05" });
  });

  it("keeps the stated date of an all-day midnight given with a positive offset", async () => {
    const result = await keeperApi.createEvent(WRITE_USER_ID, googleInput({
      endTime: "2026-11-06T00:00:00+09:00",
      isAllDay: true,
      startTime: "2026-11-05T00:00:00+09:00",
    }));
    const [created] = await readCreatedRows();
    const [write] = writesTo("POST");

    expect(result.success).toBe(true);
    expect(readDateField(write?.body ?? null, "start")).toEqual({ date: "2026-11-05" });
    expect(readDateField(write?.body ?? null, "end")).toEqual({ date: "2026-11-06" });
    expect({ end: created?.endTime, start: created?.startTime }).toEqual({
      end: "2026-11-06T00:00:00.000Z",
      start: "2026-11-05T00:00:00.000Z",
    });
  });
});

describe("updating an event through the API", () => {
  it("stores and sends a wall time read in the request timezone", async () => {
    const result = await keeperApi.updateEvent(WRITE_USER_ID, TIMED_EVENT_ID, routePatchUpdates({
      endTime: "2026-11-05T10:00:00",
      startTime: "2026-11-05T09:00:00",
      timezone: "America/Edmonton",
    }));
    const stored = await readStoredRow(TIMED_EVENT_ID);
    const [write] = writesTo("PATCH");
    const sentStart = readDateField(write?.body ?? null, "start").dateTime ?? "";

    expect(result.success).toBe(true);
    expect(stored).toEqual({
      endTime: "2026-11-05T16:00:00.000Z",
      isAllDay: false,
      startTime: "2026-11-05T15:00:00.000Z",
      startTimeZone: "America/Edmonton",
    });
    expect(toIso(sentStart)).toBe("2026-11-05T15:00:00.000Z");
    expect(EXPLICIT_OFFSET.test(sentStart)).toBe(true);
  });

  it("rejects a wall time sent without a timezone and leaves the event untouched", async () => {
    const result = await keeperApi.updateEvent(WRITE_USER_ID, TIMED_EVENT_ID, routePatchUpdates({
      startTime: "2026-11-05T09:00:00",
    }));

    expect(result.success).toBe(false);
    expect(String(result.error).toLowerCase()).toContain("timezone");
    expect(writesTo("PATCH")).toEqual([]);
    expect(await readStoredRow(TIMED_EVENT_ID)).toEqual({
      endTime: "2026-11-05T15:00:00.000Z",
      isAllDay: false,
      startTime: "2026-11-05T14:00:00.000Z",
      startTimeZone: "America/Toronto",
    });
  });

  it("rejects a timezone that does not resolve and leaves the event untouched", async () => {
    const result = await keeperApi.updateEvent(WRITE_USER_ID, TIMED_EVENT_ID, routePatchUpdates({
      timezone: "Mars/Olympus",
    }));

    expect(result.success).toBe(false);
    expect(writesTo("PATCH")).toEqual([]);
    const stored = await readStoredRow(TIMED_EVENT_ID);
    expect(stored.startTimeZone).toBe("America/Toronto");
  });

  it("reads a local midnight on a stored all-day event as its calendar date", async () => {
    const result = await keeperApi.updateEvent(WRITE_USER_ID, ALL_DAY_EVENT_ID, routePatchUpdates({
      endTime: "2026-11-10T00:00:00",
      startTime: "2026-11-09T00:00:00",
    }));
    const stored = await readStoredRow(ALL_DAY_EVENT_ID);
    const [write] = writesTo("PATCH");

    expect(result.success).toBe(true);
    expect({ end: stored.endTime, isAllDay: stored.isAllDay, start: stored.startTime }).toEqual({
      end: "2026-11-10T00:00:00.000Z",
      isAllDay: true,
      start: "2026-11-09T00:00:00.000Z",
    });
    expect(readDateField(write?.body ?? null, "start")).toEqual({ date: "2026-11-09" });
  });

  it("keeps the stored timezone when only the title changes", async () => {
    const result = await keeperApi.updateEvent(WRITE_USER_ID, TIMED_EVENT_ID, routePatchUpdates({
      title: "Renamed",
    }));

    expect(result.success).toBe(true);
    expect(await readStoredRow(TIMED_EVENT_ID)).toEqual({
      endTime: "2026-11-05T15:00:00.000Z",
      isAllDay: false,
      startTime: "2026-11-05T14:00:00.000Z",
      startTimeZone: "America/Toronto",
    });
  });

  it("re-sends the stored instants when only the timezone changes", async () => {
    const result = await keeperApi.updateEvent(WRITE_USER_ID, TIMED_EVENT_ID, routePatchUpdates({
      timezone: "America/Edmonton",
    }));
    const stored = await readStoredRow(TIMED_EVENT_ID);
    const [write] = writesTo("PATCH");

    expect(result.success).toBe(true);
    expect(stored).toEqual({
      endTime: "2026-11-05T15:00:00.000Z",
      isAllDay: false,
      startTime: "2026-11-05T14:00:00.000Z",
      startTimeZone: "America/Edmonton",
    });
    expect({
      end: toIso(readDateField(write?.body ?? null, "end").dateTime),
      start: toIso(readDateField(write?.body ?? null, "start").dateTime),
    }).toEqual({
      end: "2026-11-05T15:00:00.000Z",
      start: "2026-11-05T14:00:00.000Z",
    });
  });
});
