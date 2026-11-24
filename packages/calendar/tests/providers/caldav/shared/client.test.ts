import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalDAVClient,
  CalDAVCreateConflictError,
} from "../../../../src/providers/caldav/shared/client";

const davMocks = vi.hoisted(() => ({
  createCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
  updateCalendarObject: vi.fn(),
}));

vi.mock("tsdav", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createDAVClient: () => Promise.resolve({
    createCalendarObject: davMocks.createCalendarObject,
    deleteCalendarObject: davMocks.deleteCalendarObject,
    updateCalendarObject: davMocks.updateCalendarObject,
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

  it("names the precondition a refused create carries in its DAV error body", async () => {
    davMocks.createCalendarObject.mockResolvedValueOnce(
      new Response(
        "<D:error xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\"><C:no-uid-conflict/></D:error>",
        { status: 412, statusText: "Precondition Failed" },
      ),
    );
    const client = createClient();

    await expect(client.createCalendarObject({
      calendarUrl: "https://caldav.example.com/calendar/",
      filename: "event.ics",
      iCalString: "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
    })).rejects.toMatchObject({ precondition: "no-uid-conflict", status: 412 });
  });

  it("names the precondition a refused update carries in its DAV error body", async () => {
    davMocks.updateCalendarObject.mockResolvedValueOnce(
      new Response(
        "<D:error xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\"><C:no-uid-conflict/></D:error>",
        { status: 412, statusText: "Precondition Failed" },
      ),
    );
    const client = createClient();

    await expect(client.updateCalendarObjectByUrl({
      iCalString: "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
      objectUrl: "https://caldav.example.com/calendar/event.ics",
    })).rejects.toMatchObject({
      message: expect.stringContaining("no-uid-conflict"),
      precondition: "no-uid-conflict",
      status: 412,
    });
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
