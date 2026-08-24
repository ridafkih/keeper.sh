import { describe, expect, it } from "vitest";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import { resolveRepresentableTimeRange } from "../../../src/core/events/time-range";
import type { MaterializedSyncableEvent, SyncableEvent } from "../../../src/core/types";
import { parseGoogleEvents } from "../../../src/providers/google/source/utils/fetch-events";
import { serializeGoogleEvent } from "../../../src/providers/google/destination/serialize-event";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const buildAllDayMaster = (overrides: Partial<SyncableEvent> = {}): SyncableEvent => ({
  availability: "busy",
  calendarId: "calendar-1",
  calendarName: "Primary",
  calendarUrl: null,
  endTime: new Date("2027-03-13T00:00:00.000Z"),
  id: "event-state-1",
  isAllDay: true,
  recurrenceRule: { count: 8, frequency: "DAILY" },
  sourceEventUid: "source-uid-1",
  startTime: new Date("2027-03-12T00:00:00.000Z"),
  startTimeZone: "America/New_York",
  summary: "Daily all-day standup",
  ...overrides,
} as SyncableEvent);

const publish = (occurrence: MaterializedSyncableEvent): { end: string; start: string } => {
  const { endTime, startTime } = resolveRepresentableTimeRange(occurrence);
  return { end: endTime.toISOString(), start: startTime.toISOString() };
};

const publishedSpans = (
  master: SyncableEvent,
  window: { end: string; start: string },
): { end: string; start: string }[] =>
  materializeRecurrenceEvents([master], {
    end: new Date(window.end),
    start: new Date(window.start),
  }).map((occurrence) => publish(occurrence));

const spanLengthsInDays = (spans: { end: string; start: string }[]): number[] =>
  spans.map((span) => (new Date(span.end).getTime() - new Date(span.start).getTime()) / MS_PER_DAY);

const overlappingSpans = (spans: { end: string; start: string }[]): string[] => {
  const ordered = spans.toSorted((left, right) => left.start.localeCompare(right.start));
  const overlaps: string[] = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous && current && current.start < previous.end) {
      overlaps.push(`${previous.start}..${previous.end} overlaps ${current.start}..${current.end}`);
    }
  }

  return overlaps;
};

const SPRING_WINDOW = { end: "2027-03-25T00:00:00.000Z", start: "2027-03-01T00:00:00.000Z" };
const AUTUMN_WINDOW = { end: "2027-11-18T00:00:00.000Z", start: "2027-11-01T00:00:00.000Z" };

describe("a daily all-day series expanded across a daylight transition", () => {
  it("publishes exactly one whole UTC day per occurrence through spring forward", () => {
    const spans = publishedSpans(buildAllDayMaster(), SPRING_WINDOW);

    expect(spanLengthsInDays(spans)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("publishes exactly one whole UTC day per occurrence through the autumn fold", () => {
    const spans = publishedSpans(
      buildAllDayMaster({
        endTime: new Date("2027-11-06T00:00:00.000Z"),
        startTime: new Date("2027-11-05T00:00:00.000Z"),
      }),
      AUTUMN_WINDOW,
    );

    expect(spanLengthsInDays(spans)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("never publishes two occurrences of one series over the same day", () => {
    const spans = publishedSpans(buildAllDayMaster(), SPRING_WINDOW);

    expect(overlappingSpans(spans)).toEqual([]);
  });

  it("covers eight consecutive days with eight daily occurrences", () => {
    const spans = publishedSpans(buildAllDayMaster(), SPRING_WINDOW);

    expect(spans.map((span) => span.start)).toEqual([
      "2027-03-12T00:00:00.000Z",
      "2027-03-13T00:00:00.000Z",
      "2027-03-14T00:00:00.000Z",
      "2027-03-15T00:00:00.000Z",
      "2027-03-16T00:00:00.000Z",
      "2027-03-17T00:00:00.000Z",
      "2027-03-18T00:00:00.000Z",
      "2027-03-19T00:00:00.000Z",
    ]);
  });

  it("keeps the day count of a multi-day all-day series", () => {
    const spans = publishedSpans(
      buildAllDayMaster({
        endTime: new Date("2027-03-15T00:00:00.000Z"),
        recurrenceRule: { count: 3, frequency: "WEEKLY" },
        startTime: new Date("2027-03-12T00:00:00.000Z"),
      }),
      { end: "2027-04-10T00:00:00.000Z", start: "2027-03-01T00:00:00.000Z" },
    );

    expect(spanLengthsInDays(spans)).toEqual([3, 3, 3]);
  });

  it("leaves a series in a zone without daylight saving aligned", () => {
    const spans = publishedSpans(
      buildAllDayMaster({ startTimeZone: "Asia/Tokyo" }),
      SPRING_WINDOW,
    );

    expect(spanLengthsInDays(spans)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("materializes the same spans on a second run", () => {
    const master = buildAllDayMaster();

    expect(publishedSpans(master, SPRING_WINDOW)).toEqual(publishedSpans(master, SPRING_WINDOW));
  });
});

describe("a recurring all-day event as Google states it", () => {
  it("is parsed as an all-day event carrying the calendar's timezone", () => {
    const [parsed] = parseGoogleEvents([{
      end: { date: "2027-03-13", timeZone: "America/New_York" },
      iCalUID: "series@google.com",
      id: "series",
      recurrence: ["RRULE:FREQ=DAILY;COUNT=8"],
      start: { date: "2027-03-12", timeZone: "America/New_York" },
      summary: "Daily all-day standup",
    }] as unknown as Parameters<typeof parseGoogleEvents>[0]);

    expect({
      allDay: parsed?.isAllDay,
      start: parsed?.startTime.toISOString(),
      zone: parsed?.startTimeZone,
    }).toEqual({
      allDay: true,
      start: "2027-03-12T00:00:00.000Z",
      zone: "America/New_York",
    });
  });
});

describe("mirroring an occurrence that follows a daylight transition", () => {
  it("writes a single day to Google", () => {
    const occurrences = materializeRecurrenceEvents([buildAllDayMaster()], {
      end: new Date(SPRING_WINDOW.end),
      start: new Date(SPRING_WINDOW.start),
    });
    const afterTransition = occurrences.at(-1);
    if (!afterTransition) {
      throw new Error("Expected the series to materialize an occurrence");
    }

    const serialized = serializeGoogleEvent(afterTransition, "uid@keeper.sh");

    expect({ end: serialized?.end, start: serialized?.start }).toEqual({
      end: { date: "2027-03-20" },
      start: { date: "2027-03-19" },
    });
  });
});
