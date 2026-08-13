import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleEvent } from "../../../src/mutations/providers/google";
import { createOutlookEvent } from "../../../src/mutations/providers/outlook";
import type { EventInput } from "../../../src/types";

const toInput = (
  startTime: string,
  endTime: string,
  isAllDay: boolean,
): EventInput => ({
  calendarId: "00000000-0000-4000-8000-00000000a002",
  endTime,
  isAllDay,
  startTime,
  title: "Offset form",
} as EventInput);

const readRequestBody = (fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> => {
  const [, init] = fetchMock.mock.calls[0] ?? [];
  const body = (init as RequestInit | undefined)?.body;
  if (typeof body !== "string") {
    throw new TypeError("No request body was sent to the provider");
  }
  return JSON.parse(body);
};

const readRange = (
  value: Record<string, unknown>,
): { end: string; start: string } => {
  const start = value.start as Record<string, string> | undefined;
  const end = value.end as Record<string, string> | undefined;
  return {
    end: end?.date ?? end?.dateTime ?? "",
    start: start?.date ?? start?.dateTime ?? "",
  };
};

const jsonResponse = (payload: unknown): Response => Response.json(payload, { status: 200 });

const stubGoogleFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
    iCalUID: "uid@google.com",
    id: "google-event",
  })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const stubOutlookFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
    iCalUId: "uid-outlook",
    id: "outlook-event",
  })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("creating an event stated with an ISO offset form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends Outlook the UTC instant for a timed range stated ahead of UTC", async () => {
    const fetchMock = stubOutlookFetch();

    const result = await createOutlookEvent("token", toInput(
      "2027-05-10T08:00:00+02:00",
      "2027-05-10T09:00:00+02:00",
      false,
    ));

    expect(result.success).toBe(true);
    expect(readRange(readRequestBody(fetchMock))).toEqual({
      end: "2027-05-10T07:00:00.000Z",
      start: "2027-05-10T06:00:00.000Z",
    });
  });

  it("sends Outlook the UTC instant for a timed range stated behind UTC", async () => {
    const fetchMock = stubOutlookFetch();

    const result = await createOutlookEvent("token", toInput(
      "2027-05-09T22:00:00-05:00",
      "2027-05-09T23:00:00-05:00",
      false,
    ));

    expect(result.success).toBe(true);
    expect(readRange(readRequestBody(fetchMock))).toEqual({
      end: "2027-05-10T04:00:00.000Z",
      start: "2027-05-10T03:00:00.000Z",
    });
  });

  it("sends Outlook offset-free wall values for an all-day range stated behind UTC", async () => {
    const fetchMock = stubOutlookFetch();

    const result = await createOutlookEvent("token", toInput(
      "2027-05-09T19:00:00-05:00",
      "2027-05-10T19:00:00-05:00",
      true,
    ));

    expect(result.success).toBe(true);
    expect(readRange(readRequestBody(fetchMock))).toEqual({
      end: "2027-05-11T00:00:00.000",
      start: "2027-05-10T00:00:00.000",
    });
  });

  it("sends Google the date of the instant for an all-day range stated behind UTC", async () => {
    const fetchMock = stubGoogleFetch();

    const result = await createGoogleEvent("token", "primary", toInput(
      "2027-05-09T19:00:00-05:00",
      "2027-05-10T19:00:00-05:00",
      true,
    ));

    expect(result.success).toBe(true);
    expect(readRange(readRequestBody(fetchMock))).toEqual({
      end: "2027-05-11",
      start: "2027-05-10",
    });
  });

  it("sends Google the date of the instant for an all-day range stated ahead of UTC", async () => {
    const fetchMock = stubGoogleFetch();

    const result = await createGoogleEvent("token", "primary", toInput(
      "2027-05-11T00:30:00+03:00",
      "2027-05-12T00:30:00+03:00",
      true,
    ));

    expect(result.success).toBe(true);
    expect(readRange(readRequestBody(fetchMock))).toEqual({
      end: "2027-05-12",
      start: "2027-05-10",
    });
  });

  it("passes a stated offset form through for a timed Google range", async () => {
    const fetchMock = stubGoogleFetch();

    const result = await createGoogleEvent("token", "primary", toInput(
      "2027-05-10T08:00:00+02:00",
      "2027-05-10T09:00:00+02:00",
      false,
    ));

    expect(result.success).toBe(true);
    expect(readRange(readRequestBody(fetchMock))).toEqual({
      end: "2027-05-10T09:00:00+02:00",
      start: "2027-05-10T08:00:00+02:00",
    });
  });
});
