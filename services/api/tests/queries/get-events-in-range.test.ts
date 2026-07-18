import { describe, expect, it } from "vitest";
import { RecurrenceMaterializationLimitError } from "@keeper.sh/calendar";
import { flattenSyncedEvents } from "../../src/queries/get-events-in-range";
import {
  parseEventReference,
  projectSyncedEvents,
} from "../../src/queries/event-read-model";

const MASTER_ID = "019c0000-0000-7000-8000-000000000001";
const OVERRIDE_ID = "019c0000-0000-7000-8000-000000000002";

const sourceMap = new Map([
  [
    "calendar-1",
    {
      name: "Source",
      provider: "ics",
      url: null,
      userId: "user-1",
    },
  ],
]);

const rows = [
  {
    availability: "busy",
    calendarId: "calendar-1",
    description: null,
    endTime: new Date("2026-03-02T11:00:00.000Z"),
    exceptionDates: null,
    id: MASTER_ID,
    isAllDay: false,
    location: null,
    recurrenceId: null,
    recurrenceRule: JSON.stringify({ count: 2, frequency: "WEEKLY" }),
    sourceEventUid: "series-1",
    startTime: new Date("2026-03-02T10:00:00.000Z"),
    startTimeZone: "Etc/UTC",
    title: "Master",
  },
  {
    availability: "free",
    calendarId: "calendar-1",
    description: null,
    endTime: new Date("2026-03-10T13:00:00.000Z"),
    exceptionDates: null,
    id: OVERRIDE_ID,
    isAllDay: true,
    location: null,
    recurrenceId: new Date("2026-03-09T10:00:00.000Z"),
    recurrenceRule: null,
    sourceEventUid: "series-1",
    startTime: new Date("2026-03-10T12:00:00.000Z"),
    startTimeZone: "Etc/UTC",
    title: "Override",
  },
];

const flatten = (filters?: { availability?: string[]; isAllDay?: boolean }) =>
  flattenSyncedEvents(
    rows,
    sourceMap,
    new Date("2026-03-01T00:00:00.000Z"),
    new Date("2026-03-31T23:59:59.999Z"),
    filters,
  );

describe("flattenSyncedEvents", () => {
  it("exposes separate, addressable identities for generated occurrences", () => {
    const events = flatten();
    const generatedOccurrence = events.find((event) => event.eventStateId === MASTER_ID);
    const detachedOverride = events.find((event) => event.eventStateId === OVERRIDE_ID);
    if (!generatedOccurrence || !detachedOverride) {
      throw new Error("Expected a generated occurrence and detached override");
    }

    expect(generatedOccurrence.id).not.toBe(MASTER_ID);
    expect(parseEventReference(generatedOccurrence.id)).toEqual({
      occurrenceStart: generatedOccurrence.startTime,
      resourceId: MASTER_ID,
    });
    expect(detachedOverride.id).toBe(OVERRIDE_ID);

    const exactProjection = projectSyncedEvents(
      rows,
      sourceMap,
      generatedOccurrence.startTime,
      generatedOccurrence.startTime,
    );
    expect(exactProjection).toContainEqual(generatedOccurrence);
  });

  it("rejects internal recurrence hashes and malformed occurrence references", () => {
    expect(parseEventReference("recurrence-opaque-internal-hash")).toBeNull();
    expect(parseEventReference(`occurrence:${MASTER_ID}:not-a-timestamp`)).toBeNull();
    expect(parseEventReference(`occurrence:${MASTER_ID}:9007199254740992`)).toBeNull();
    expect(parseEventReference(`occurrence:${MASTER_ID}:1772445600000:extra`)).toBeNull();
    expect(parseEventReference("not-a-uuid")).toBeNull();
  });

  it("round-trips occurrences before the Unix epoch", () => {
    expect(parseEventReference(`occurrence:${MASTER_ID}:-86400000`))
      .toEqual({
        occurrenceStart: new Date("1969-12-31T00:00:00.000Z"),
        resourceId: MASTER_ID,
      });
  });

  it("reconciles detached overrides before applying availability filters", () => {
    expect(flatten({ availability: ["busy"] }).map((event) => event.title)).toEqual(["Master"]);
    expect(flatten({ availability: ["free"] }).map((event) => event.title)).toEqual(["Override"]);
  });

  it("reconciles detached overrides before applying all-day filters", () => {
    expect(flatten({ isAllDay: false }).map((event) => event.title)).toEqual(["Master"]);
    expect(flatten({ isAllDay: true }).map((event) => event.title)).toEqual(["Override"]);
  });

  it("surfaces an explicit recurrence limit error instead of returning a partial range", () => {
    const [baseMaster] = rows;
    if (!baseMaster) {
      throw new Error("Expected the recurring master fixture");
    }
    const pathologicalMaster = {
      ...baseMaster,
      endTime: new Date("2026-03-01T00:00:01.000Z"),
      id: "pathological-master",
      recurrenceRule: JSON.stringify({ frequency: "SECONDLY" }),
      sourceEventUid: "pathological-series",
      startTime: new Date("2026-03-01T00:00:00.000Z"),
    };

    expect(() => flattenSyncedEvents(
      [pathologicalMaster],
      sourceMap,
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-02T00:00:00.000Z"),
    )).toThrow(RecurrenceMaterializationLimitError);
  });
});
