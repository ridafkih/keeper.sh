import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutlookSourceWriter } from "../../../../src/providers/outlook/source/mutations";

const ACCESS_TOKEN = "outlook-access-token";
const SOURCE_EVENT_ID = "outlook-event-id";
const SOURCE_EVENT_UID = "source-event-uid";
const ALL_DAY_START = new Date("2027-05-13T00:00:00.000Z");
const ALL_DAY_END = new Date("2027-05-14T00:00:00.000Z");
const TIMED_START = new Date("2027-05-11T17:00:00.000Z");
const TIMED_END = new Date("2027-05-11T18:00:00.000Z");
const SOURCE_TIME_ZONE = "America/Toronto";

interface RecordedRequest {
  body: Record<string, unknown>;
  method: string;
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

const createWriter = () =>
  createOutlookSourceWriter({ accessToken: () => Promise.resolve(ACCESS_TOKEN) });

describe("createOutlookSourceWriter", () => {
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

  it("declares the event all-day alongside the times it moves", async () => {
    await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { endTime: ALL_DAY_END, isAllDay: true, startTime: ALL_DAY_START },
    );

    expect(requireWrite(requests, "PATCH").body).toEqual({
      end: { dateTime: "2027-05-14T00:00:00.000", timeZone: "UTC" },
      isAllDay: true,
      start: { dateTime: "2027-05-13T00:00:00.000", timeZone: "UTC" },
    });
  });

  it("keeps a timed event in the zone the source stores it in", async () => {
    await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      {
        endTime: TIMED_END,
        isAllDay: false,
        startTime: TIMED_START,
        startTimeZone: SOURCE_TIME_ZONE,
      },
    );

    expect(requireWrite(requests, "PATCH").body).toEqual({
      end: { dateTime: "2027-05-11T14:00:00.000", timeZone: SOURCE_TIME_ZONE },
      isAllDay: false,
      start: { dateTime: "2027-05-11T13:00:00.000", timeZone: SOURCE_TIME_ZONE },
    });
  });

  it("falls back to UTC only when the source stores no zone", async () => {
    await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { endTime: TIMED_END, isAllDay: false, startTime: TIMED_START },
    );

    expect(requireWrite(requests, "PATCH").body).toEqual({
      end: { dateTime: "2027-05-11T18:00:00.000", timeZone: "UTC" },
      isAllDay: false,
      start: { dateTime: "2027-05-11T17:00:00.000", timeZone: "UTC" },
    });
  });

  it("holds an all-day event at midnight rather than re-reading it in the source zone", async () => {
    await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      {
        endTime: ALL_DAY_END,
        isAllDay: true,
        startTime: ALL_DAY_START,
        startTimeZone: SOURCE_TIME_ZONE,
      },
    );

    expect(requireWrite(requests, "PATCH").body).toEqual({
      end: { dateTime: "2027-05-14T00:00:00.000", timeZone: "UTC" },
      isAllDay: true,
      start: { dateTime: "2027-05-13T00:00:00.000", timeZone: "UTC" },
    });
  });

  it("refuses a schedule write that does not say whether the event is all-day", async () => {
    await expect(createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { endTime: ALL_DAY_END, startTime: ALL_DAY_START },
    )).rejects.toThrow(/all-day flag/);
    expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
  });

  /*
   * The UID of an event on the user's calendar is chosen by whoever invited them, so an
   * unescaped one closes the filter's quoted literal and the lookup resolves whichever
   * event the rest of the UID names instead.
   */
  it("keeps a quote in the uid inside the literal it is looking up", async () => {
    await createWriter().updateEvent(
      { sourceEventId: null, sourceEventUid: "abc' or startswith(subject,'A" },
      { summary: "Renamed on the destination" },
    );

    const lookup = requests.find(({ url }) => url.includes("iCalUId"));
    expect(new URL(requireValue(lookup).url).searchParams.get("$filter"))
      .toBe("iCalUId eq 'abc'' or startswith(subject,''A'");
  });

  it("reports an already-deleted event as a successful delete", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 404 }))) as unknown as typeof fetch;

    await expect(createWriter().deleteEvent({
      sourceEventId: SOURCE_EVENT_ID,
      sourceEventUid: SOURCE_EVENT_UID,
    })).resolves.toEqual({ success: true });
  });
});
