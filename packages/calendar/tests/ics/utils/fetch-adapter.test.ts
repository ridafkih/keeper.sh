import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPullRemoteCalendar } = vi.hoisted(() => ({
  mockPullRemoteCalendar: vi.fn<(...args: unknown[]) => Promise<{ ical: string }>>(),
}));
const { mockCreateSnapshot } = vi.hoisted(() => ({
  mockCreateSnapshot: vi.fn<(...args: unknown[]) => Promise<{ changed: boolean }>>(),
}));

vi.mock("../../../src/ics/utils/pull-remote-calendar", () => ({
  pullRemoteCalendar: mockPullRemoteCalendar,
}));
vi.mock("../../../src/ics/utils/create-snapshot", () => ({
  createSnapshot: mockCreateSnapshot,
}));

const MINIMAL_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//test//EN",
  "BEGIN:VEVENT",
  "UID:event-1@test",
  "DTSTAMP:20260517T000000Z",
  "DTSTART:20260517T120000Z",
  "DTEND:20260517T130000Z",
  "SUMMARY:Test",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const buildConfig = () => ({
  calendarId: "calendar-1",
  url: "https://example.com/calendar.ics",
  database: {} as never,
});

describe("createIcsSourceFetcher", () => {
  beforeEach(() => {
    mockPullRemoteCalendar.mockReset();
    mockCreateSnapshot.mockReset();
  });

  it("propagates fetch errors instead of returning empty events", async () => {
    /*
     * Regression: previously this path returned {events: []}, which caused
     * ingestSource to delete every existing event_state on a transient hiccup.
     */
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    mockPullRemoteCalendar.mockRejectedValueOnce(new Error("network unreachable"));

    const fetcher = createIcsSourceFetcher(buildConfig());

    await expect(fetcher.fetchEvents()).rejects.toThrow("network unreachable");
    expect(mockCreateSnapshot).not.toHaveBeenCalled();
  });

  it("returns parsed events on a successful changed fetch", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: MINIMAL_ICS });
    mockCreateSnapshot.mockResolvedValueOnce({ changed: true });

    const fetcher = createIcsSourceFetcher(buildConfig());
    const result = await fetcher.fetchEvents();

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.uid).toBe("event-1@test");
    expect(result.unchanged).toBeUndefined();
  });

  it("returns unchanged when snapshot content has not changed", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: MINIMAL_ICS });
    mockCreateSnapshot.mockResolvedValueOnce({ changed: false });

    const fetcher = createIcsSourceFetcher(buildConfig());
    const result = await fetcher.fetchEvents();

    expect(result.events).toEqual([]);
    expect(result.unchanged).toBe(true);
  });
});
