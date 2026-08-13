import { afterEach, describe, expect, it, vi } from "vitest";
import { listUserCalendars } from "../../../../../src/providers/google/source/utils/list-calendars";

const calendarEntry = (overrides: Record<string, unknown> = {}) => ({
  accessRole: "owner",
  id: "calendar-1@group.calendar.google.com",
  summary: "Work",
  ...overrides,
});

describe("listUserCalendars", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns no calendars when Google omits the empty items array", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({
      kind: "calendar#calendarList",
    }))));

    await expect(listUserCalendars("access-token")).resolves.toEqual([]);
  });

  it("falls back to the calendar ID when an entry has no display name", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({
      items: [{ accessRole: "owner", id: "unnamed@example.com" }],
      kind: "calendar#calendarList",
    }))));

    const [calendar] = await listUserCalendars("access-token");

    expect(calendar?.summary).toBe("unnamed@example.com");
  });

  it("keeps the readable calendars when one entry is unusable and reports the count", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({
      items: [
        calendarEntry({ id: "good-1", summary: "Work" }),
        { accessRole: "owner", summary: "Missing an ID" },
        calendarEntry({ id: "good-2", summary: "Personal" }),
      ],
      kind: "calendar#calendarList",
    }))));
    const onInvalidEntries = vi.fn();

    const calendars = await listUserCalendars("access-token", { onInvalidEntries });

    expect(calendars.map((calendar) => calendar.id)).toEqual(["good-1", "good-2"]);
    expect(onInvalidEntries).toHaveBeenCalledWith(1);
  });

  it("pages through the calendar list", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        items: [calendarEntry({ id: "page-1" })],
        kind: "calendar#calendarList",
        nextPageToken: "token-2",
      }))
      .mockResolvedValueOnce(Response.json({
        items: [calendarEntry({ id: "page-2" })],
        kind: "calendar#calendarList",
      }));
    vi.stubGlobal("fetch", fetchMock);

    const calendars = await listUserCalendars("access-token");

    expect(calendars.map((calendar) => calendar.id)).toEqual(["page-1", "page-2"]);
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get("pageToken")).toBe("token-2");
  });

  it("throws an authentication-required error when Google rejects the token", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))));

    await expect(listUserCalendars("access-token")).rejects.toMatchObject({
      authRequired: true,
      status: 401,
    });
  });
});
