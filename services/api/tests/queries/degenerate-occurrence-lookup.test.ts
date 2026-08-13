import { describe, expect, it } from "vitest";
import { projectSyncedEvents } from "../../src/queries/event-read-model";
import type { SourceInfo, SyncedEventRow } from "../../src/queries/event-read-model";
import { resolveEventReadModel } from "../../src/queries/get-event";
import type { EventReadRepository, SyncedEventOwner } from "../../src/queries/get-event";

const USER_ID = "user-1";
const CALENDAR_ID = "calendar-1";
const WINDOW_START = new Date("2027-03-08T00:00:00.000Z");
const WINDOW_END = new Date("2027-04-08T00:00:00.000Z");

const SOURCE: SourceInfo = { name: "Source", provider: "ics", url: null, userId: USER_ID };
const sourceMap = new Map([[CALENDAR_ID, SOURCE]]);

const buildRow = (overrides: Partial<SyncedEventRow> & { id: string }): SyncedEventRow => ({
  availability: "busy",
  calendarId: CALENDAR_ID,
  description: null,
  endTime: new Date("2027-03-09T00:00:00.000Z"),
  exceptionDates: null,
  isAllDay: null,
  location: null,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventUid: "series-uid",
  startTime: new Date("2027-03-08T00:00:00.000Z"),
  startTimeZone: "Etc/UTC",
  title: "Series",
  ...overrides,
});

const SERIES: { label: string; row: SyncedEventRow }[] = [
  {
    label: "an all-day series that does not sit on the UTC day grid",
    row: buildRow({
      endTime: new Date("2027-03-08T17:00:00.000Z"),
      id: "019c0000-0000-7000-8000-000000000101",
      isAllDay: true,
      recurrenceRule: JSON.stringify({ count: 3, frequency: "WEEKLY" }),
      startTime: new Date("2027-03-08T09:00:00.000Z"),
    }),
  },
  {
    label: "a zero-duration series",
    row: buildRow({
      endTime: new Date("2027-03-08T09:00:00.000Z"),
      id: "019c0000-0000-7000-8000-000000000102",
      isAllDay: false,
      recurrenceRule: JSON.stringify({ count: 3, frequency: "WEEKLY" }),
      startTime: new Date("2027-03-08T09:00:00.000Z"),
    }),
  },
  {
    label: "an inverted series",
    row: buildRow({
      endTime: new Date("2027-03-07T09:00:00.000Z"),
      id: "019c0000-0000-7000-8000-000000000103",
      isAllDay: false,
      recurrenceRule: JSON.stringify({ count: 3, frequency: "WEEKLY" }),
      startTime: new Date("2027-03-08T09:00:00.000Z"),
    }),
  },
];

const buildRepository = (row: SyncedEventRow): EventReadRepository => {
  const owner: SyncedEventOwner = {
    ...row,
    calendarName: SOURCE.name,
    calendarProvider: SOURCE.provider,
    calendarUrl: SOURCE.url,
  };

  return {
    getSeriesRows: () => Promise.resolve([row]),
    getSyncedOwner: (requestedUserId, resourceId) => {
      if (requestedUserId !== USER_ID || resourceId !== row.id) {
        return Promise.resolve(null);
      }
      return Promise.resolve(owner);
    },
    getUserEvent: () => Promise.resolve(null),
  };
};

describe("looking an occurrence up by the identifier the listing published", () => {
  for (const { label, row } of SERIES) {
    it(`resolves every occurrence of ${label}`, async () => {
      const listed = projectSyncedEvents([row], sourceMap, WINDOW_START, WINDOW_END);
      expect(listed.length).toBeGreaterThan(1);

      const repository = buildRepository(row);
      const missing: string[] = [];
      for (const occurrence of listed) {
        const fetched = await resolveEventReadModel(repository, USER_ID, occurrence.id);
        if (!fetched) {
          missing.push(occurrence.id);
          continue;
        }
        if (
          fetched.startTime !== occurrence.startTime.toISOString()
          || fetched.endTime !== occurrence.endTime.toISOString()
        ) {
          missing.push(`${occurrence.id} answered ${fetched.startTime}/${fetched.endTime}`);
        }
      }

      expect(missing).toEqual([]);
    });
  }

  it("publishes the same identifiers on a repeated listing", () => {
    const rows = SERIES.map(({ row }) => row);
    const first = projectSyncedEvents(rows, sourceMap, WINDOW_START, WINDOW_END);
    const second = projectSyncedEvents(rows, sourceMap, WINDOW_START, WINDOW_END);

    expect(second.map((event) => event.id)).toEqual(first.map((event) => event.id));
  });
});
