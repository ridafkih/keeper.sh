import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleEvent } from "../../../src/mutations/providers/google";
import { createOutlookEvent } from "../../../src/mutations/providers/outlook";
import { createCalDAVEvent } from "../../../src/mutations/providers/caldav";
import type { EventInput } from "../../../src/types";

const { createCalendarObjectMock } = vi.hoisted(() => ({
  createCalendarObjectMock: vi.fn(),
}));

vi.mock("../../../src/env", () => ({
  default: { ENCRYPTION_KEY: "test-key" },
}));

vi.mock("tsdav", () => ({
  createDAVClient: vi.fn(() => ({
    createCalendarObject: createCalendarObjectMock,
    deleteCalendarObject: vi.fn(),
    fetchCalendarObjects: vi.fn(),
    updateCalendarObject: vi.fn(),
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

interface Shape {
  endTime: string;
  isAllDay: boolean;
  name: string;
  startTime: string;
}

const SHAPES: Shape[] = [
  {
    endTime: "2027-05-10T14:00:00.000Z",
    isAllDay: false,
    name: "a timed range whose start and end are the same instant",
    startTime: "2027-05-10T14:00:00.000Z",
  },
  {
    endTime: "2027-05-09T18:00:00.000Z",
    isAllDay: false,
    name: "a timed range whose end precedes its start",
    startTime: "2027-05-10T14:00:00.000Z",
  },
  {
    endTime: "2027-05-10T00:00:00.000Z",
    isAllDay: true,
    name: "an all-day range naming one date twice",
    startTime: "2027-05-10T00:00:00.000Z",
  },
  {
    endTime: "2027-05-10T17:00:00.000Z",
    isAllDay: true,
    name: "an all-day range off the UTC day grid",
    startTime: "2027-05-10T09:00:00.000Z",
  },
];

const toInput = (shape: Shape): EventInput => ({
  calendarId: "00000000-0000-4000-8000-00000000a001",
  endTime: shape.endTime,
  isAllDay: shape.isAllDay,
  startTime: shape.startTime,
  title: "Degenerate",
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

describe("creating an event whose range covers no interval", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createCalendarObjectMock.mockReset();
    createCalendarObjectMock.mockResolvedValue({});
  });

  for (const shape of SHAPES) {
    it(`sends Google a range it accepts for ${shape.name}`, async () => {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
        iCalUID: "uid@google.com",
        id: "google-event",
      })));
      vi.stubGlobal("fetch", fetchMock);

      const result = await createGoogleEvent("token", "primary", toInput(shape));
      const { end, start } = readRange(readRequestBody(fetchMock));

      expect(result.success).toBe(true);
      expect({ end, start, wider: end > start }).toEqual({ end, start, wider: true });
    });

    it(`sends Outlook a range it accepts for ${shape.name}`, async () => {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
        iCalUId: "uid-outlook",
        id: "outlook-event",
      })));
      vi.stubGlobal("fetch", fetchMock);

      const result = await createOutlookEvent("token", toInput(shape));
      const { end, start } = readRange(readRequestBody(fetchMock));
      const wholeDays = !shape.isAllDay
        || (start.endsWith("T00:00:00.000") && end.endsWith("T00:00:00.000"));

      expect(result.success).toBe(true);
      expect({ end, start, wholeDays, wider: end > start })
        .toEqual({ end, start, wholeDays: true, wider: true });
    });

    it(`writes CalDAV a resource whose DTEND follows its DTSTART for ${shape.name}`, async () => {
      const result = await createCalDAVEvent(CALDAV_CREDENTIALS, toInput(shape));
      const [call] = createCalendarObjectMock.mock.calls;
      const icsString = String((call?.[0] as { iCalString?: string } | undefined)?.iCalString ?? "");
      const startLine = /^DTSTART[^:]*:(.+)$/m.exec(icsString)?.[1]?.trim() ?? "";
      const endLine = /^DTEND[^:]*:(.+)$/m.exec(icsString)?.[1]?.trim() ?? "";

      expect(result.success).toBe(true);
      expect({ end: endLine, start: startLine, wider: endLine > startLine })
        .toEqual({ end: endLine, start: startLine, wider: true });
    });
  }
});
