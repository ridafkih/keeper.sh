import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCalDAVEvent, updateCalDAVEvent, deleteCalDAVEvent, rsvpCalDAVEvent, getPendingCalDAVInvites } from "../../../src/mutations/providers/caldav";

const {
  createCalendarObjectMock,
  fetchCalendarObjectsMock,
  updateCalendarObjectMock,
  deleteCalendarObjectMock,
} = vi.hoisted(() => ({
  createCalendarObjectMock: vi.fn(),
  fetchCalendarObjectsMock: vi.fn(),
  updateCalendarObjectMock: vi.fn(),
  deleteCalendarObjectMock: vi.fn(),
}));

vi.mock("../../../src/env", () => ({
  default: {
    ENCRYPTION_KEY: "test-key",
  },
}));

vi.mock("tsdav", () => ({
  createDAVClient: vi.fn(() => ({
    createCalendarObject: createCalendarObjectMock,
    fetchCalendarObjects: fetchCalendarObjectsMock,
    updateCalendarObject: updateCalendarObjectMock,
    deleteCalendarObject: deleteCalendarObjectMock,
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

describe("caldav provider mutations", () => {
  const mockCredentials = {
    serverUrl: "https://dav.com",
    calendarUrl: "https://dav.com/cal",
    username: "user",
    encryptedPassword: "enc",
    encryptionKey: "key",
    authMethod: "basic",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createCalendarObjectMock.mockResolvedValue({});
    fetchCalendarObjectsMock.mockResolvedValue([
      { url: "url", data: "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:uid\nEND:VEVENT\nEND:VCALENDAR" },
    ]);
    updateCalendarObjectMock.mockResolvedValue({});
    deleteCalendarObjectMock.mockResolvedValue({});
  });

  describe("createCalDAVEvent", () => {
    it("calls tsdav createCalendarObject and returns UID", async () => {
      const result = await createCalDAVEvent(mockCredentials, {
        title: "Test",
        startTime: "2026-01-01T10:00:00Z",
        endTime: "2026-01-01T11:00:00Z",
        calendarId: "cal-1",
      });

      expect(result.success).toBe(true);
      expect(result.sourceEventUid).toBeDefined();
    });

    it("emits a TZID-qualified DTSTART when startTimeZone is provided", async () => {
      const result = await createCalDAVEvent(mockCredentials, {
        title: "Appointment",
        startTime: "2026-06-17T10:45:00Z",
        endTime: "2026-06-17T11:45:00Z",
        calendarId: "cal-1",
        startTimeZone: "America/Montevideo",
      });

      expect(result.success).toBe(true);
      const icsString = createCalendarObjectMock.mock.calls[0]?.[0]?.iCalString as string;
      expect(icsString).toContain("DTSTART;TZID=America/Montevideo:20260617T074500");
      expect(icsString).not.toContain("DTSTART:20260617T104500Z");
    });

    it("emits a bare UTC DTSTART when no timezone is provided", async () => {
      await createCalDAVEvent(mockCredentials, {
        title: "Appointment",
        startTime: "2026-06-17T10:45:00Z",
        endTime: "2026-06-17T11:45:00Z",
        calendarId: "cal-1",
      });

      const icsString = createCalendarObjectMock.mock.calls[0]?.[0]?.iCalString as string;
      expect(icsString).toContain("DTSTART:20260617T104500Z");
      expect(icsString).not.toContain("TZID=");
    });

    it("keeps all-day events timezone-less even with a timezone", async () => {
      await createCalDAVEvent(mockCredentials, {
        title: "Holiday",
        startTime: "2026-03-08T00:00:00Z",
        endTime: "2026-03-09T00:00:00Z",
        calendarId: "cal-1",
        isAllDay: true,
        startTimeZone: "America/Montevideo",
      });

      const icsString = createCalendarObjectMock.mock.calls[0]?.[0]?.iCalString as string;
      expect(icsString).toContain("DTSTART;VALUE=DATE:20260308");
      expect(icsString).not.toContain("TZID=");
    });
  });

  describe("updateCalDAVEvent", () => {
    it("finds event and updates it", async () => {
      const result = await updateCalDAVEvent(mockCredentials, "uid", { title: "New" });
      expect(result.success).toBe(true);
    });

    it("emits a TZID-qualified DTSTART when the update carries a timezone", async () => {
      const result = await updateCalDAVEvent(mockCredentials, "uid", {
        startTime: "2026-06-17T10:45:00Z",
        endTime: "2026-06-17T11:45:00Z",
        startTimeZone: "America/Montevideo",
      });

      expect(result.success).toBe(true);
      const icsString = updateCalendarObjectMock.mock.calls[0]?.[0]?.calendarObject?.data as string;
      expect(icsString).toContain("DTSTART;TZID=America/Montevideo:20260617T074500");
    });

    it("preserves the event's existing timezone when the update omits one", async () => {
      fetchCalendarObjectsMock.mockResolvedValueOnce([
        {
          url: "url",
          data: [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Test//Test//EN",
            "BEGIN:VEVENT",
            "UID:uid",
            "SUMMARY:Existing",
            "DTSTART;TZID=America/Montevideo:20260617T074500",
            "DTEND;TZID=America/Montevideo:20260617T084500",
            "END:VEVENT",
            "END:VCALENDAR",
          ].join("\r\n"),
        },
      ]);

      const result = await updateCalDAVEvent(mockCredentials, "uid", {
        startTime: "2026-06-18T10:45:00Z",
        endTime: "2026-06-18T11:45:00Z",
      });

      expect(result.success).toBe(true);
      const icsString = updateCalendarObjectMock.mock.calls[0]?.[0]?.calendarObject?.data as string;
      expect(icsString).toContain("DTSTART;TZID=America/Montevideo:20260618T074500");
    });
  });

  describe("deleteCalDAVEvent", () => {
    it("deletes event", async () => {
      const result = await deleteCalDAVEvent(mockCredentials, "uid");
      expect(result.success).toBe(true);
    });
  });

  describe("rsvpCalDAVEvent", () => {
    it("finds event and updates attendee", async () => {
      const result = await rsvpCalDAVEvent(mockCredentials, "uid", "accepted", "test@example.com");
      expect(result.success).toBe(true);
    });
  });

  describe("getPendingCalDAVInvites", () => {
    it("returns pending invites", async () => {
      const invites = await getPendingCalDAVInvites(mockCredentials, "2026-01-01", "2026-01-02", "test@example.com");
      // The mock does not provide a parseable invite shape, so none are returned.
      expect(invites).toHaveLength(0);
    });
  });
});
