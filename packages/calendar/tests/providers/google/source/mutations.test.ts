import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TWO_WAY_SOURCE_WRITE_TIMEOUT_MS } from "@keeper.sh/constants";
import { createGoogleSourceWriter } from "../../../../src/providers/google/source/mutations";

const ACCESS_TOKEN = "google-access-token";
const SOURCE_EVENT_ID = "google-event-id";
const SOURCE_EVENT_UID = "source-event-uid@example.com";
const ALL_DAY_START = new Date("2027-05-13T00:00:00.000Z");
const ALL_DAY_END = new Date("2027-05-14T00:00:00.000Z");
const TIMED_START = new Date("2027-05-11T17:00:00.000Z");
const TIMED_END = new Date("2027-05-11T18:00:00.000Z");
const NOT_FOUND_STATUS = 404;
const GONE_STATUS = 410;

interface RecordedRequest {
  body: Record<string, unknown>;
  method: string;
  signal: AbortSignal | null | undefined;
  url: string;
}

const requireValue = (request?: RecordedRequest): RecordedRequest => {
  if (!request) {
    throw new Error("Expected a recorded request");
  }
  return request;
};

/*
 * Every write is preceded by a read of the event it would touch, so the request that
 * carries the payload is selected by its method rather than by its position.
 */
const requireWrite = (requests: RecordedRequest[], method: string): RecordedRequest =>
  requireValue(requests.find((request) => request.method === method));

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

describe("createGoogleSourceWriter", () => {
  let requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    requests = [];
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      requests.push({
        body: readJsonBody(init?.body),
        method: init?.method ?? "GET",
        signal: init?.signal,
        url: String(input),
      });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends an all-day move as calendar dates, never as instants", async () => {
    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { endTime: ALL_DAY_END, isAllDay: true, startTime: ALL_DAY_START },
    );

    expect(result).toEqual({ success: true });
    expect(requireWrite(requests, "PATCH").body).toEqual({
      end: { date: "2027-05-14" },
      start: { date: "2027-05-13" },
    });
  });

  it("sends a timed move as instants", async () => {
    await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { endTime: TIMED_END, isAllDay: false, startTime: TIMED_START },
    );

    expect(requireWrite(requests, "PATCH").body).toEqual({
      end: { dateTime: TIMED_END.toISOString() },
      start: { dateTime: TIMED_START.toISOString() },
    });
  });

  it("refuses a schedule write that does not say whether the event is all-day", async () => {
    await expect(createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { endTime: ALL_DAY_END, startTime: ALL_DAY_START },
    )).rejects.toThrow(/all-day flag/);
    expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
  });

  it("never sends a field the payload does not carry", async () => {
    await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { endTime: TIMED_END, isAllDay: false, startTime: TIMED_START },
    );

    expect(requireWrite(requests, "PATCH").body).not.toHaveProperty("summary");
    expect(requireWrite(requests, "PATCH").body).not.toHaveProperty("description");
  });

  it("uses the known event id rather than resolving the UID", async () => {
    await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(requests.filter(({ url }) => url.includes("iCalUID"))).toEqual([]);
    expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1);
    expect(requireWrite(requests, "PATCH").url).toContain(SOURCE_EVENT_ID);
  });

  it.each([NOT_FOUND_STATUS, GONE_STATUS])(
    "lets a deletion the server answers %i with complete on the retry",
    async (status) => {
      globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(
        { error: { message: "Resource has been deleted" } },
        { status },
      ))) as unknown as typeof fetch;

      await expect(createWriter().deleteEvent({
        sourceEventId: SOURCE_EVENT_ID,
        sourceEventUid: SOURCE_EVENT_UID,
      })).resolves.toEqual({ success: true });
    },
  );

  it("bounds the write with the lock-safe timeout and forwards the caller's signal", async () => {
    const controller = new AbortController();
    await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
      controller.signal,
    );

    const { signal } = requireWrite(requests, "PATCH");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(TWO_WAY_SOURCE_WRITE_TIMEOUT_MS).toBeLessThan(30_000);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });
});
