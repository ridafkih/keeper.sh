import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSourceWriter } from "../../../../src/providers/google/source/mutations";

const ACCESS_TOKEN = "google-access-token";
const SOURCE_EVENT_ID = "google-event-id";
const SOURCE_EVENT_UID = "source-event-uid@example.com";
const SOURCE_TIME_ZONE = "America/Toronto";
const TIMED_START = new Date("2027-05-11T17:00:00.000Z");
const TIMED_END = new Date("2027-05-11T18:00:00.000Z");
const ALL_DAY_START = new Date("2027-05-13T00:00:00.000Z");
const ALL_DAY_END = new Date("2027-05-14T00:00:00.000Z");

interface RecordedRequest {
  body: Record<string, unknown>;
  method: string;
  url: string;
}

const readJsonBody = (body: unknown): Record<string, unknown> => {
  if (typeof body !== "string") {
    return {};
  }
  return JSON.parse(body) as Record<string, unknown>;
};

const createWriter = () => createGoogleSourceWriter({
  accessToken: () => Promise.resolve(ACCESS_TOKEN),
  externalCalendarId: "primary",
});

const requirePatch = (requests: RecordedRequest[]): Record<string, unknown> => {
  const patch = requests.find((request) => request.method === "PATCH");
  if (!patch) {
    throw new Error("Expected the writer to PATCH the source event");
  }
  return patch.body;
};

describe("Google source writer: the source keeps its own timezone", () => {
  let requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    requests = [];
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      requests.push({
        body: readJsonBody(init?.body),
        method: init?.method ?? "GET",
        url: String(input),
      });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends the source timezone alongside the instant on a timed move", async () => {
    await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      {
        endTime: TIMED_END,
        isAllDay: false,
        startTime: TIMED_START,
        startTimeZone: SOURCE_TIME_ZONE,
      },
    );

    const body = requirePatch(requests);

    expect(body["start"]).toEqual({
      dateTime: TIMED_START.toISOString(),
      timeZone: SOURCE_TIME_ZONE,
    });
    expect(body["end"]).toEqual({
      dateTime: TIMED_END.toISOString(),
      timeZone: SOURCE_TIME_ZONE,
    });
  });

  it("never lets Google re-home a travelling event to the calendar default", async () => {
    await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      {
        endTime: TIMED_END,
        isAllDay: false,
        startTime: TIMED_START,
        startTimeZone: SOURCE_TIME_ZONE,
      },
    );

    const start = requirePatch(requests)["start"] as Record<string, unknown>;

    expect(Object.hasOwn(start, "timeZone")).toBe(true);
  });

  it("sends calendar dates with no timezone at all on an all-day move", async () => {
    await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      {
        endTime: ALL_DAY_END,
        isAllDay: true,
        startTime: ALL_DAY_START,
        startTimeZone: SOURCE_TIME_ZONE,
      },
    );

    const body = requirePatch(requests);

    expect(body["start"]).toEqual({ date: "2027-05-13" });
    expect(body["end"]).toEqual({ date: "2027-05-14" });
  });

  it("omits the timezone when the source row holds none", async () => {
    await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { endTime: TIMED_END, isAllDay: false, startTime: TIMED_START },
    );

    const start = requirePatch(requests)["start"] as Record<string, unknown>;

    expect(start).toEqual({ dateTime: TIMED_START.toISOString() });
  });
});
