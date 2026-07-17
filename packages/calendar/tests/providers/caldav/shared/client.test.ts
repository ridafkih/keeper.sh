import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalDAVClient,
  CalDAVCreateConflictError,
} from "../../../../src/providers/caldav/shared/client";

const davMocks = vi.hoisted(() => ({
  createCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
}));

vi.mock("tsdav", () => ({
  createDAVClient: () => Promise.resolve({
    createCalendarObject: davMocks.createCalendarObject,
    deleteCalendarObject: davMocks.deleteCalendarObject,
  }),
}));

const createClient = () =>
  new CalDAVClient({
    credentials: { password: "pass", username: "user" },
    serverUrl: "https://caldav.example.com",
  });

describe("CalDAVClient write responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies a 412 from create as a create conflict", async () => {
    davMocks.createCalendarObject.mockResolvedValueOnce(
      new Response(null, { status: 412, statusText: "Precondition Failed" }),
    );
    const client = createClient();

    await expect(client.createCalendarObject({
      calendarUrl: "https://caldav.example.com/calendar/",
      filename: "event.ics",
      iCalString: "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
    })).rejects.toBeInstanceOf(CalDAVCreateConflictError);
  });

  it("rejects unsuccessful delete responses", async () => {
    davMocks.deleteCalendarObject.mockResolvedValueOnce(
      new Response(null, { status: 500, statusText: "Server Error" }),
    );
    const client = createClient();

    await expect(client.deleteCalendarObject({
      calendarUrl: "https://caldav.example.com/calendar/",
      filename: "event.ics",
    })).rejects.toMatchObject({
      name: "CalDAVHttpError",
      operation: "delete",
      status: 500,
    });
  });
});
