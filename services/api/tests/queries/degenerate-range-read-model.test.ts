import { describe, expect, it } from "vitest";
import { projectSyncedEvents } from "../../src/queries/event-read-model";
import type { SyncedEventRow } from "../../src/queries/event-read-model";

const WINDOW_START = new Date("2027-03-08T00:00:00.000Z");
const WINDOW_END = new Date("2027-04-08T00:00:00.000Z");

const sourceMap = new Map([
  ["calendar-1", { name: "Source", provider: "ics", url: null, userId: "user-1" }],
]);

const buildRow = (overrides: Partial<SyncedEventRow> & { id: string }): SyncedEventRow => ({
  availability: "busy",
  calendarId: "calendar-1",
  description: null,
  endTime: new Date("2027-03-20T16:00:00.000Z"),
  exceptionDates: null,
  isAllDay: false,
  location: null,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventUid: overrides.id,
  startTime: new Date("2027-03-20T16:00:00.000Z"),
  startTimeZone: "Etc/UTC",
  title: "Event",
  ...overrides,
});

const ROWS: { label: string; row: SyncedEventRow }[] = [
  {
    label: "ordinary range",
    row: buildRow({
      endTime: new Date("2027-03-20T17:00:00.000Z"),
      id: "019c0000-0000-7000-8000-000000000001",
      startTime: new Date("2027-03-20T16:00:00.000Z"),
    }),
  },
  {
    label: "zero-duration range",
    row: buildRow({
      endTime: new Date("2027-03-21T16:00:00.000Z"),
      id: "019c0000-0000-7000-8000-000000000002",
      startTime: new Date("2027-03-21T16:00:00.000Z"),
    }),
  },
  {
    label: "same-date all-day range",
    row: buildRow({
      endTime: new Date("2027-03-22T00:00:00.000Z"),
      id: "019c0000-0000-7000-8000-000000000003",
      isAllDay: true,
      startTime: new Date("2027-03-22T00:00:00.000Z"),
    }),
  },
  {
    label: "inverted range whose start sits inside the window",
    row: buildRow({
      endTime: new Date("2027-03-05T16:00:00.000Z"),
      id: "019c0000-0000-7000-8000-000000000004",
      startTime: new Date("2027-03-23T16:00:00.000Z"),
    }),
  },
];

const project = () => projectSyncedEvents(
  ROWS.map(({ row }) => row),
  sourceMap,
  WINDOW_START,
  WINDOW_END,
);

describe("the read model behind get_events, get_event and find_free_time", () => {
  it("returns every degenerate row the scan now admits", () => {
    expect(project()).toHaveLength(ROWS.length);
  });

  it("answers identically on repeated projections", () => {
    const first = project().map((event) => `${event.id}|${event.startTime.toISOString()}|${event.endTime.toISOString()}`);
    const second = project().map((event) => `${event.id}|${event.startTime.toISOString()}|${event.endTime.toISOString()}`);

    expect(second).toEqual(first);
  });

  it("never emits a range that ends before it starts", () => {
    const inverted = project()
      .filter((event) => event.endTime.getTime() < event.startTime.getTime())
      .map((event) => event.id);

    expect(inverted).toEqual([]);
  });
});
