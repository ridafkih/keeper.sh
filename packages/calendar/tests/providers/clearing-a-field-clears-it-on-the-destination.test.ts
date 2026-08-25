import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../src/providers/google/destination/provider";
import { createOutlookSyncProvider } from "../../src/providers/outlook/destination/provider";
import type { CalendarSyncProvider } from "../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent } from "../../src/core/types";

const batchMocks = vi.hoisted(() => ({
  executeBatchChunked: vi.fn(),
}));

vi.mock("../../src/providers/google/shared/batch", () => ({
  executeBatchChunked: batchMocks.executeBatchChunked,
}));

interface SubRequest {
  method: string;
  path: string;
  body?: unknown;
}

interface SubResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

type StoredEvent = Record<string, unknown>;

const GOOGLE_EVENT_ID = "google-event-id-abc123";
const OUTLOOK_EVENT_ID = "AAMkAGViNDU3OWQzLWRlLTQ0";
const STALE_DESCRIPTION = "Bring the printed deck";
const STALE_LOCATION = "Room 4, third floor";

const clearedEvent: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-15T09:00:00.000Z"),
  summary: "Meeting",
};

const overTheWire = (body: unknown): Record<string, unknown> => {
  if (body === null || body === globalThis.undefined) {
    return {};
  }
  const wireText = JSON.stringify(body);
  const encoded: unknown = JSON.parse(wireText);
  if (typeof encoded !== "object" || encoded === null) {
    return {};
  }
  return { ...encoded } as Record<string, unknown>;
};

const applyMergeSemantics = (stored: StoredEvent, sent: Record<string, unknown>): StoredEvent => {
  const merged: StoredEvent = {};
  for (const [key, value] of Object.entries(stored)) {
    if (sent[key] !== null) {
      merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(sent)) {
    if (value !== null) {
      merged[key] = value;
    }
  }
  return merged;
};

const nextGoogleState = (
  stored: StoredEvent,
  method: string,
  sent: Record<string, unknown>,
): StoredEvent => {
  if (method === "PATCH") {
    return applyMergeSemantics(stored, sent);
  }
  return { iCalUID: stored["iCalUID"], id: GOOGLE_EVENT_ID, ...sent };
};

const nextOutlookState = (
  stored: StoredEvent,
  method: string,
  sent: Record<string, unknown>,
): StoredEvent => {
  if (method === "PATCH") {
    return applyMergeSemantics(stored, sent);
  }
  return { iCalUId: stored["iCalUId"], id: OUTLOOK_EVENT_ID, ...sent };
};

const createGoogleStore = (): { read: () => StoredEvent; handle: (request: SubRequest) => SubResponse } => {
  let stored: StoredEvent = {
    description: STALE_DESCRIPTION,
    end: { dateTime: "2026-03-15T10:00:00Z" },
    iCalUID: "keeper-uid-1@keeper.sh",
    id: GOOGLE_EVENT_ID,
    location: STALE_LOCATION,
    start: { dateTime: "2026-03-15T09:00:00Z" },
    summary: "Meeting",
  };

  const handle = (request: SubRequest): SubResponse => {
    const sent = overTheWire(request.body);
    stored = nextGoogleState(stored, request.method, sent);
    return { body: { ...stored }, headers: {}, statusCode: 200 };
  };

  return { handle, read: () => stored };
};

const createOutlookStore = (): { read: () => StoredEvent; handle: (init: RequestInit) => Response } => {
  let stored: StoredEvent = {
    body: { content: STALE_DESCRIPTION, contentType: "text" },
    categories: ["keeper.sh"],
    end: { dateTime: "2026-03-15T10:00:00.0000000", timeZone: "UTC" },
    iCalUId: "outlook-ical-uid-1",
    id: OUTLOOK_EVENT_ID,
    isAllDay: false,
    location: { displayName: STALE_LOCATION },
    showAs: "busy",
    start: { dateTime: "2026-03-15T09:00:00.0000000", timeZone: "UTC" },
    subject: "Meeting",
  };

  const handle = (init: RequestInit): Response => {
    const sent = overTheWire(JSON.parse(String(init.body)));
    stored = nextOutlookState(stored, String(init.method), sent);
    return Response.json({ ...stored });
  };

  return { handle, read: () => stored };
};

const createGoogleProvider = (): CalendarSyncProvider => createGoogleSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  calendarId: "cal-1",
  externalCalendarId: "primary",
  refreshToken: "test-refresh",
  userId: "user-1",
});

const createOutlookProvider = (): CalendarSyncProvider => createOutlookSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  calendarId: "cal-1",
  externalCalendarId: "external-cal-1",
  refreshToken: "test-refresh",
  userId: "user-1",
});

describe("clearing a field clears it on the destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops a google description and location the source no longer carries", async () => {
    const store = createGoogleStore();
    batchMocks.executeBatchChunked.mockImplementation(
      (requests: SubRequest[]) => Promise.resolve(requests.map((request) => store.handle(request))),
    );

    const provider = createGoogleProvider();
    const results = await provider.updateEvents?.([
      { deleteId: GOOGLE_EVENT_ID, event: clearedEvent },
    ]) ?? [];

    expect(results[0]).toMatchObject({ success: true });

    const remote = store.read();
    expect(remote["summary"]).toBe("Meeting");
    expect(remote["description"]).toBeFalsy();
    expect(remote["location"]).toBeFalsy();
  });

  it("drops an outlook body and location the source no longer carries", async () => {
    const store = createOutlookStore();
    const fetchSpy = vi.fn((_input: string | URL, init: RequestInit) =>
      Promise.resolve(store.handle(init)));
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createOutlookProvider();
    const results = await provider.updateEvents?.([
      { deleteId: OUTLOOK_EVENT_ID, event: clearedEvent },
    ]) ?? [];

    expect(results[0]).toMatchObject({ success: true });

    const remote = store.read();
    expect(remote["subject"]).toBe("Meeting");
    expect(remote["body"]).toBeFalsy();
    expect(remote["location"]).toBeFalsy();
  });
});
