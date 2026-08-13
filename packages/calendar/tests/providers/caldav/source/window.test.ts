import { describe, expect, it } from "vitest";
import { buildCalDAVSourceEvents } from "../../../../src/providers/caldav/source/window";
import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";
import type { ParsedCalendarEvent } from "../../../../src/providers/caldav/shared/ics";

const SYNC_WINDOW = {
  timeMax: new Date("2026-06-01T00:00:00.000Z"),
  timeMin: new Date("2026-03-01T00:00:00.000Z"),
};

const makeParsed = (overrides: Partial<ParsedCalendarEvent>): ParsedCalendarEvent => ({
  deleteId: "uid",
  endTime: new Date("2026-03-10T10:30:00.000Z"),
  isKeeperEvent: false,
  startTime: new Date("2026-03-10T10:00:00.000Z"),
  uid: "uid",
  ...overrides,
});

const uidsOf = (parsedEvents: ParsedCalendarEvent[]): (string | undefined)[] =>
  buildCalDAVSourceEvents(parsedEvents, SYNC_WINDOW).map(({ uid }) => uid);

describe("buildCalDAVSourceEvents", () => {
  it("keeps a zero-duration event sitting exactly on the window start", () => {
    expect(uidsOf([makeParsed({
      endTime: SYNC_WINDOW.timeMin,
      startTime: SYNC_WINDOW.timeMin,
      uid: "zero-at-edge",
    })])).toEqual(["zero-at-edge"]);
  });

  it("keeps an inverted range whose start sits inside the window", () => {
    expect(uidsOf([makeParsed({
      endTime: new Date("2026-02-20T09:00:00.000Z"),
      startTime: new Date("2026-03-10T10:00:00.000Z"),
      uid: "inverted",
    })])).toEqual(["inverted"]);
  });

  it("drops an event that lies entirely before the window", () => {
    expect(uidsOf([makeParsed({
      endTime: new Date("2026-02-01T11:00:00.000Z"),
      startTime: new Date("2026-02-01T10:00:00.000Z"),
      uid: "past",
    })])).toEqual([]);
  });

  it("drops Keeper's own mirrored events", () => {
    expect(uidsOf([makeParsed({ uid: `mirrored${KEEPER_EVENT_SUFFIX}` })])).toEqual([]);
  });

  it("carries the stated range and recurrence through unchanged", () => {
    const [event] = buildCalDAVSourceEvents([makeParsed({
      endTime: new Date("2026-03-10T10:00:00.000Z"),
      recurrenceDuration: { seconds: 0 },
      recurrenceRule: { frequency: "WEEKLY" },
      startTime: new Date("2026-03-10T10:00:00.000Z"),
      uid: "series",
    })], SYNC_WINDOW);

    expect(event?.startTime).toEqual(new Date("2026-03-10T10:00:00.000Z"));
    expect(event?.endTime).toEqual(new Date("2026-03-10T10:00:00.000Z"));
    expect(event?.recurrenceDuration).toEqual({ seconds: 0 });
  });
});
