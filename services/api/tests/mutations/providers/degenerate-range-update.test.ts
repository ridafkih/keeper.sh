import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateGoogleEvent } from "../../../src/mutations/providers/google";
import { updateOutlookEvent } from "../../../src/mutations/providers/outlook";
import { updateCalDAVEvent } from "../../../src/mutations/providers/caldav";
import { completeUpdateRange } from "../../../src/mutations";
import type { EventUpdateInput } from "../../../src/types";

const { createCalendarObjectMock, fetchCalendarObjectsMock, updateCalendarObjectMock } = vi.hoisted(
  () => ({
    createCalendarObjectMock: vi.fn(),
    fetchCalendarObjectsMock: vi.fn(),
    updateCalendarObjectMock: vi.fn(),
  }),
);

vi.mock("../../../src/env", () => ({
  default: { ENCRYPTION_KEY: "test-key" },
}));

vi.mock("tsdav", () => ({
  createDAVClient: vi.fn(() => ({
    createCalendarObject: createCalendarObjectMock,
    deleteCalendarObject: vi.fn(),
    fetchCalendarObjects: fetchCalendarObjectsMock,
    updateCalendarObject: updateCalendarObjectMock,
  })),
}));

vi.mock("@keeper.sh/database", () => ({
  decryptPassword: vi.fn(() => "decrypted"),
}));

vi.mock("@keeper.sh/calendar/safe-fetch", () => ({
  createSafeFetch: vi.fn(() => vi.fn()),
}));

vi.mock("@keeper.sh/calendar/digest-fetch", () => ({
  createDigestAwareFetch: vi.fn(() => ({ fetch: vi.fn() })),
  resolveAuthMethod: vi.fn(),
}));

const CALDAV_CREDENTIALS = {
  authMethod: "basic",
  calendarUrl: "https://dav.com/cal",
  encryptedPassword: "enc",
  encryptionKey: "key",
  serverUrl: "https://dav.com",
  username: "user",
};

const EXISTING_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//Test//EN",
  "BEGIN:VEVENT",
  "UID:uid",
  "SUMMARY:Existing",
  "DTSTART:20270510T090000Z",
  "DTEND:20270510T100000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const INVERTED: EventUpdateInput = {
  endTime: "2027-05-09T18:00:00.000Z",
  startTime: "2027-05-10T14:00:00.000Z",
} as EventUpdateInput;

const jsonResponse = (payload: unknown): Response => Response.json(payload, { status: 200 });

const readPatchRange = (
  fetchMock: ReturnType<typeof vi.fn>,
): { end: string; start: string } => {
  const [, init] = fetchMock.mock.calls[1] ?? [];
  const patch = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
  const start = patch.start as Record<string, string>;
  const end = patch.end as Record<string, string>;
  return {
    end: end.date ?? end.dateTime ?? "",
    start: start.date ?? start.dateTime ?? "",
  };
};

describe("updating an event to a range that covers no interval", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    updateCalendarObjectMock.mockReset();
    updateCalendarObjectMock.mockResolvedValue({});
    fetchCalendarObjectsMock.mockReset();
    fetchCalendarObjectsMock.mockResolvedValue([{ data: EXISTING_ICS, url: "url" }]);
  });

  it("patches Google with a span that still grows", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
      items: [{ id: "google-event", start: { dateTime: "2027-05-10T09:00:00Z" } }],
    })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateGoogleEvent("token", "primary", "uid", INVERTED);
    const { end, start } = readPatchRange(fetchMock);

    expect(result.success).toBe(true);
    expect({ end, start, wider: end > start }).toEqual({ end, start, wider: true });
  });

  it("patches Outlook with a span that still grows", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
      value: [{ id: "outlook-event", isAllDay: false }],
    })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateOutlookEvent("token", "uid", INVERTED);
    const { end, start } = readPatchRange(fetchMock);

    expect(result.success).toBe(true);
    expect({ end, start, wider: end > start }).toEqual({ end, start, wider: true });
  });

  it("writes CalDAV a DTEND that follows its DTSTART", async () => {
    const result = await updateCalDAVEvent(CALDAV_CREDENTIALS, "uid", INVERTED);
    const icsString = String(
      (updateCalendarObjectMock.mock.calls[0]?.[0] as { calendarObject?: { data?: string } })
        ?.calendarObject?.data ?? "",
    );
    const start = /^DTSTART[^:]*:(.+)$/m.exec(icsString)?.[1]?.trim() ?? "";
    const end = /^DTEND[^:]*:(.+)$/m.exec(icsString)?.[1]?.trim() ?? "";

    expect(result.success).toBe(true);
    expect({ end, start, wider: end > start }).toEqual({ end, start, wider: true });
  });
});

describe("an update that names only one end of the range", () => {
  const stored = {
    endTime: new Date("2027-05-10T10:00:00.000Z"),
    startTime: new Date("2027-05-10T09:00:00.000Z"),
  };

  it("carries the stored end when only the start moves", () => {
    expect(completeUpdateRange({ startTime: "2027-05-10T14:00:00.000Z" } as EventUpdateInput, stored))
      .toEqual({
        endTime: "2027-05-10T10:00:00.000Z",
        startTime: "2027-05-10T14:00:00.000Z",
      });
  });

  it("carries the stored start when only the end moves", () => {
    expect(completeUpdateRange({ endTime: "2027-05-10T08:00:00.000Z" } as EventUpdateInput, stored))
      .toEqual({
        endTime: "2027-05-10T08:00:00.000Z",
        startTime: "2027-05-10T09:00:00.000Z",
      });
  });

  it("leaves an update carrying no range alone", () => {
    expect(completeUpdateRange({ title: "Renamed" } as EventUpdateInput, stored))
      .toEqual({ title: "Renamed" });
  });
});
