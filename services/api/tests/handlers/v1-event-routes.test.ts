import { describe, expect, it, vi } from "vitest";
import { handleGetV1EventsRoute } from "../../src/handlers/event-routes";
import type { V1EventsReader } from "../../src/handlers/event-routes";

vi.mock("../../src/env", () => ({
  default: { ENCRYPTION_KEY: "test-key" },
}));

const createRecordingReader = () => {
  const countRanges: unknown[] = [];
  const listCalls: unknown[][] = [];
  const reader: V1EventsReader = {
    getEventCount: (_userId, range) => {
      countRanges.push(range);
      return Promise.resolve(3);
    },
    getEventsInRange: (_userId, range, filters) => {
      listCalls.push([range, filters]);
      return Promise.resolve([]);
    },
  };
  return { countRanges, listCalls, reader };
};

const request = (query: string): Request => new Request(`https://api.test/api/v1/events?${query}`);

const RANGE = "from=2026-11-05T06:00:00.000Z&to=2026-11-06T05:59:59.999Z";

describe("handleGetV1EventsRoute", () => {
  it("passes the viewer timezone to the event count", async () => {
    const { countRanges, listCalls, reader } = createRecordingReader();

    const response = await handleGetV1EventsRoute(request(`${RANGE}&count=true&timezone=America/Chicago`), "user-1", reader);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 3 });
    expect(countRanges).toEqual([{
      from: new Date("2026-11-05T06:00:00.000Z"),
      timeZone: "America/Chicago",
      to: new Date("2026-11-06T05:59:59.999Z"),
    }]);
    expect(listCalls).toEqual([]);
  });

  it("passes the viewer timezone and filters to the event list", async () => {
    const { countRanges, listCalls, reader } = createRecordingReader();

    const response = await handleGetV1EventsRoute(
      request(`${RANGE}&timezone=America/Chicago&isAllDay=true&calendarId=a,b`),
      "user-1",
      reader,
    );

    expect(response.status).toBe(200);
    expect(listCalls).toEqual([[
      {
        from: new Date("2026-11-05T06:00:00.000Z"),
        timeZone: "America/Chicago",
        to: new Date("2026-11-06T05:59:59.999Z"),
      },
      { calendarId: ["a", "b"], isAllDay: true },
    ]]);
    expect(countRanges).toEqual([]);
  });

  it("reads by instant when no timezone is given", async () => {
    const { listCalls, reader } = createRecordingReader();

    await handleGetV1EventsRoute(request(RANGE), "user-1", reader);

    expect(listCalls[0]?.[0]).toEqual({
      from: new Date("2026-11-05T06:00:00.000Z"),
      to: new Date("2026-11-06T05:59:59.999Z"),
    });
  });

  it.each(["count=true&", ""])("rejects an unknown timezone with a 400 (%s)", async (countQuery) => {
    const { countRanges, listCalls, reader } = createRecordingReader();

    const response = await handleGetV1EventsRoute(request(`${RANGE}&${countQuery}timezone=Nowhere/Land`), "user-1", reader);

    expect(response.status).toBe(400);
    expect(countRanges).toEqual([]);
    expect(listCalls).toEqual([]);
  });
});
