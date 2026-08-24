import { describe, expect, it } from "vitest";
import { RecurrenceMaterializationLimitError } from "@keeper.sh/calendar";
import {
  handleGetEventRoute,
  handleGetEventsInRangeRoute,
} from "../../src/handlers/event-routes";
import type { KeeperEvent } from "../../src/types";

const SERIES_ID = "019c0000-0000-7000-8000-000000000001";
const SERIES_UID = "pathological-series-1";
const OCCURRENCE_BUDGET = 10_000;

const createLimitError = (): RecurrenceMaterializationLimitError =>
  new RecurrenceMaterializationLimitError(
    {
      calendarId: "calendar-1",
      eventId: SERIES_ID,
      sourceEventUid: SERIES_UID,
    },
    OCCURRENCE_BUDGET,
  );

const readError = async (response: Response): Promise<string | null> => {
  const body = await response.json() as { error: string | null };
  return body.error;
};

describe("handleGetEventsInRangeRoute", () => {
  it("returns the events for a valid range", async () => {
    const event = { id: SERIES_ID, title: "Standup" } as KeeperEvent;

    const response = await handleGetEventsInRangeRoute(
      new Request("https://api.test/api/events?from=2026-03-01&to=2026-03-08"),
      "user-1",
      { getEventsInRange: () => Promise.resolve([event]) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([event]);
  });

  it("returns 400 when a series exceeds the recurrence budget", async () => {
    const response = await handleGetEventsInRangeRoute(
      new Request("https://api.test/api/events?from=2026-03-01&to=2026-03-08"),
      "user-1",
      { getEventsInRange: () => Promise.reject(createLimitError()) },
    );

    expect(response.status).toBe(400);
    expect(await readError(response)).toContain(SERIES_UID);
  });

  it("returns 400 when the requested range is invalid", async () => {
    const response = await handleGetEventsInRangeRoute(
      new Request("https://api.test/api/events?from=2026-03-08&to=2026-03-01"),
      "user-1",
      { getEventsInRange: () => Promise.reject(new Error("must not be called")) },
    );

    expect(response.status).toBe(400);
  });

  it("rethrows unrelated failures", async () => {
    await expect(handleGetEventsInRangeRoute(
      new Request("https://api.test/api/events?from=2026-03-01&to=2026-03-08"),
      "user-1",
      { getEventsInRange: () => Promise.reject(new Error("database is down")) },
    )).rejects.toThrow("database is down");
  });
});

describe("handleGetEventRoute", () => {
  it("returns the event when it exists", async () => {
    const event = { id: SERIES_ID, title: "Standup" } as KeeperEvent;

    const response = await handleGetEventRoute(SERIES_ID, "user-1", {
      getEvent: () => Promise.resolve(event),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(event);
  });

  it("returns 404 when the event is missing", async () => {
    const response = await handleGetEventRoute(SERIES_ID, "user-1", {
      getEvent: () => Promise.resolve(null),
    });

    expect(response.status).toBe(404);
  });

  it("returns 400 when the event id is absent", async () => {
    const response = await handleGetEventRoute(null, "user-1", {
      getEvent: () => Promise.reject(new Error("must not be called")),
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when the series exceeds the recurrence budget", async () => {
    const response = await handleGetEventRoute(SERIES_ID, "user-1", {
      getEvent: () => Promise.reject(createLimitError()),
    });

    expect(response.status).toBe(400);
    expect(await readError(response)).toContain(SERIES_UID);
  });

  it("rethrows unrelated failures", async () => {
    await expect(handleGetEventRoute(SERIES_ID, "user-1", {
      getEvent: () => Promise.reject(new Error("database is down")),
    })).rejects.toThrow("database is down");
  });
});
