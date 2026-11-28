import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateCalendarScopedEventUid } from "../../../../src/core/events/identity";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";

const server = vi.hoisted(() => ({
  fetchCalendarObjectsByUrls: () => Promise.resolve([]),
  resolveCalendarUrl: () => Promise.resolve("https://caldav.example.com/calendar/"),
  writeStatus: 401,
  writes: 0,
}));

vi.mock("../../../../src/providers/caldav/shared/client", () => {
  class MockCalDAVHttpError extends Error {
    precondition: string | null = null;
    status: number;

    constructor(status: number) {
      super(`CalDAV write failed: ${status}`);
      this.name = "CalDAVHttpError";
      this.status = status;
    }
  }

  class MockCalDAVCreateConflictError extends MockCalDAVHttpError {}

  const write = async (): Promise<void> => {
    server.writes += 1;
    await Promise.resolve();
    if (server.writeStatus >= 400) {
      throw new MockCalDAVHttpError(server.writeStatus);
    }
  };

  class CalDAVClient {
    createCalendarObject = write;
    updateCalendarObjectByUrl = write;
    deleteCalendarObject = write;
    deleteCalendarObjectByUrl = write;
    resolveCalendarUrl = server.resolveCalendarUrl;
    fetchCalendarObjectsByUrls = server.fetchCalendarObjectsByUrls;
  }

  return {
    CalDAVClient,
    CalDAVCreateConflictError: MockCalDAVCreateConflictError,
    CalDAVHttpError: MockCalDAVHttpError,
  };
});

const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const WRITE_CONCURRENCY = 5;
const EVENT_COUNT = 50;

const createEvents = (): MaterializedSyncableEvent[] =>
  Array.from({ length: EVENT_COUNT }, (_value, index) => ({
    calendarId: "source-calendar-id",
    calendarName: "Source",
    calendarUrl: null,
    endTime: new Date("2026-11-28T15:00:00.000Z"),
    id: `event-state-${index}`,
    sourceEventUid: `source-event-${index}`,
    startTime: new Date("2026-11-28T14:00:00.000Z"),
    summary: "Meeting",
  }));

const createProvider = () =>
  createCalDAVSyncProvider({
    calendarUrl: "https://caldav.example.com/calendar/",
    destinationCalendarId: DESTINATION_CALENDAR_ID,
    password: "revoked-app-password",
    serverUrl: "https://caldav.example.com",
    username: "user",
  });

describe("a CalDAV destination that refuses the login on a write", () => {
  beforeEach(() => {
    server.writeStatus = 401;
    server.writes = 0;
  });

  it("stops adding after the writes already in flight and fails the batch as a refused write", async () => {
    await expect(createProvider().pushEvents(createEvents())).rejects.toMatchObject({
      name: "CalDAVWriteRefusedError",
    });
    expect(server.writes).toBeLessThanOrEqual(WRITE_CONCURRENCY);
  });

  it("stops updating the same way", async () => {
    const updates = createEvents().map((event) => ({
      deleteId: generateCalendarScopedEventUid(event.id, DESTINATION_CALENDAR_ID),
      event,
    }));

    await expect(createProvider().updateEvents(updates)).rejects.toMatchObject({
      name: "CalDAVWriteRefusedError",
    });
    expect(server.writes).toBeLessThanOrEqual(WRITE_CONCURRENCY);
  });

  it("stops deleting the same way", async () => {
    const deleteIds = createEvents().map((event) => `/calendar/${event.id}.ics`);

    await expect(createProvider().deleteEvents(deleteIds)).rejects.toMatchObject({
      name: "CalDAVWriteRefusedError",
    });
    expect(server.writes).toBeLessThanOrEqual(WRITE_CONCURRENCY);
  });

  it("keeps writing past failures that are not about the login", async () => {
    server.writeStatus = 500;

    const results = await createProvider().pushEvents(createEvents());

    expect(results.every((result) => !result.success)).toBe(true);
    expect(server.writes).toBe(EVENT_COUNT);
  });
});
