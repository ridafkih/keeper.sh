import { describe, expect, it } from "vitest";

import {
  RecurrenceCalendarHarness,
  type SemanticOccurrence,
} from "../helpers/recurrence-calendar-harness";

const buildCalendar = (events: string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Recurrence contract//EN",
  ...events,
  "END:VCALENDAR",
].join("\r\n");

const buildMaster = (
  recurrenceRule: string,
  exceptionDate?: string,
): string => {
  const fields = [
    "BEGIN:VEVENT",
    "UID:weekly-planning@example.com",
    "DTSTAMP:20260301T000000Z",
    "DTSTART:20260302T100000Z",
    "DTEND:20260302T110000Z",
    `RRULE:${recurrenceRule}`,
  ];
  if (exceptionDate) {
    fields.push(`EXDATE:${exceptionDate}`);
  }
  fields.push(
    "SUMMARY:Weekly planning",
    "DESCRIPTION:Canonical recurring series",
    "LOCATION:Room 1",
    "END:VEVENT",
  );
  return fields.join("\r\n");
};

const buildOverride = (
  recurrenceId: string,
  start: string,
  end: string,
  summary: string,
): string => [
  "BEGIN:VEVENT",
  "UID:weekly-planning@example.com",
  "DTSTAMP:20260301T000000Z",
  `RECURRENCE-ID:${recurrenceId}`,
  `DTSTART:${start}`,
  `DTEND:${end}`,
  `SUMMARY:${summary}`,
  "DESCRIPTION:Modified occurrence",
  "LOCATION:Room 2",
  "END:VEVENT",
].join("\r\n");

const buildCancelledOverride = (recurrenceId: string): string => [
  "BEGIN:VEVENT",
  "UID:weekly-planning@example.com",
  "DTSTAMP:20260301T000000Z",
  `RECURRENCE-ID:${recurrenceId}`,
  `DTSTART:${recurrenceId}`,
  "DURATION:PT1H",
  "STATUS:CANCELLED",
  "END:VEVENT",
].join("\r\n");

const MASTER_RULE = "FREQ=WEEKLY;COUNT=6";
const MASTER = buildMaster(MASTER_RULE);

const occurrence = (
  recurrenceId: string,
  start: string,
  end: string,
  summary = "Weekly planning",
): SemanticOccurrence => ({ end, recurrenceId, start, summary });

const expectStepAndReplay = async (
  harness: RecurrenceCalendarHarness,
  ics: string,
  expected: SemanticOccurrence[],
  expectedPersistedCount: number,
  expectedFirstResult: { eventsAdded: number; eventsRemoved: number },
  expectedFirstFlushes = 1,
): Promise<void> => {
  const first = await harness.ingestIcs(ics);
  expect(first.result).toEqual(expectedFirstResult);
  expect(first.flushes).toBe(expectedFirstFlushes);
  expect(harness.persistedEventCount).toBe(expectedPersistedCount);
  expect(harness.parseKeeperCalendar().occurrences).toEqual(expected);

  const persistedBeforeReplay = harness.persistedSnapshot;
  const replay = await harness.ingestIcs(ics);

  expect(replay.result).toEqual({ eventsAdded: 0, eventsRemoved: 0 });
  expect(replay.flushes).toBe(0);
  expect(harness.persistedSnapshot).toEqual(persistedBeforeReplay);
  expect(harness.parseKeeperCalendar().occurrences).toEqual(expected);
};

describe("recurrence calendar lifecycle", () => {
  it("preserves the intended final calendar through repeated full-source mutations", async () => {
    const harness = new RecurrenceCalendarHarness();

    const initialIcs = buildCalendar([
      MASTER,
      buildOverride(
        "20260316T100000Z",
        "20260317T150000Z",
        "20260317T160000Z",
        "Planning moved once",
      ),
    ]);
    await expectStepAndReplay(
      harness,
      initialIcs,
      [
        occurrence("2026-03-02T10:00:00.000Z", "2026-03-02T10:00:00.000Z", "2026-03-02T11:00:00.000Z"),
        occurrence("2026-03-09T10:00:00.000Z", "2026-03-09T10:00:00.000Z", "2026-03-09T11:00:00.000Z"),
        occurrence("2026-03-16T10:00:00.000Z", "2026-03-17T15:00:00.000Z", "2026-03-17T16:00:00.000Z", "Planning moved once"),
        occurrence("2026-03-23T10:00:00.000Z", "2026-03-23T10:00:00.000Z", "2026-03-23T11:00:00.000Z"),
        occurrence("2026-03-30T10:00:00.000Z", "2026-03-30T10:00:00.000Z", "2026-03-30T11:00:00.000Z"),
        occurrence("2026-04-06T10:00:00.000Z", "2026-04-06T10:00:00.000Z", "2026-04-06T11:00:00.000Z"),
      ],
      2,
      { eventsAdded: 2, eventsRemoved: 0 },
    );

    const masterId = harness.findMasterId();
    const originalOverrideId = harness.findPersistedIdByRecurrenceId(
      "2026-03-16T10:00:00.000Z",
    );
    expect(masterId).not.toBeNull();
    expect(originalOverrideId).not.toBeNull();

    const movedAgainIcs = buildCalendar([
      MASTER,
      buildOverride(
        "20260316T100000Z",
        "20260318T160000Z",
        "20260318T170000Z",
        "Planning moved twice",
      ),
    ]);
    await expectStepAndReplay(
      harness,
      movedAgainIcs,
      [
        occurrence("2026-03-02T10:00:00.000Z", "2026-03-02T10:00:00.000Z", "2026-03-02T11:00:00.000Z"),
        occurrence("2026-03-09T10:00:00.000Z", "2026-03-09T10:00:00.000Z", "2026-03-09T11:00:00.000Z"),
        occurrence("2026-03-16T10:00:00.000Z", "2026-03-18T16:00:00.000Z", "2026-03-18T17:00:00.000Z", "Planning moved twice"),
        occurrence("2026-03-23T10:00:00.000Z", "2026-03-23T10:00:00.000Z", "2026-03-23T11:00:00.000Z"),
        occurrence("2026-03-30T10:00:00.000Z", "2026-03-30T10:00:00.000Z", "2026-03-30T11:00:00.000Z"),
        occurrence("2026-04-06T10:00:00.000Z", "2026-04-06T10:00:00.000Z", "2026-04-06T11:00:00.000Z"),
      ],
      2,
      { eventsAdded: 1, eventsRemoved: 0 },
    );
    expect(harness.findMasterId()).toBe(masterId);
    expect(harness.findPersistedIdByRecurrenceId("2026-03-16T10:00:00.000Z"))
      .toBe(originalOverrideId);

    const movedThirdTimeIcs = buildCalendar([
      MASTER,
      buildOverride(
        "20260316T100000Z",
        "20260319T170000Z",
        "20260319T180000Z",
        "Planning moved three times",
      ),
    ]);
    await expectStepAndReplay(
      harness,
      movedThirdTimeIcs,
      [
        occurrence("2026-03-02T10:00:00.000Z", "2026-03-02T10:00:00.000Z", "2026-03-02T11:00:00.000Z"),
        occurrence("2026-03-09T10:00:00.000Z", "2026-03-09T10:00:00.000Z", "2026-03-09T11:00:00.000Z"),
        occurrence("2026-03-16T10:00:00.000Z", "2026-03-19T17:00:00.000Z", "2026-03-19T18:00:00.000Z", "Planning moved three times"),
        occurrence("2026-03-23T10:00:00.000Z", "2026-03-23T10:00:00.000Z", "2026-03-23T11:00:00.000Z"),
        occurrence("2026-03-30T10:00:00.000Z", "2026-03-30T10:00:00.000Z", "2026-03-30T11:00:00.000Z"),
        occurrence("2026-04-06T10:00:00.000Z", "2026-04-06T10:00:00.000Z", "2026-04-06T11:00:00.000Z"),
      ],
      2,
      { eventsAdded: 1, eventsRemoved: 0 },
    );
    expect(harness.findPersistedIdByRecurrenceId("2026-03-16T10:00:00.000Z"))
      .toBe(originalOverrideId);

    const cancelledIcs = buildCalendar([
      MASTER,
      buildCancelledOverride("20260316T100000Z"),
    ]);
    await expectStepAndReplay(
      harness,
      cancelledIcs,
      [
        occurrence("2026-03-02T10:00:00.000Z", "2026-03-02T10:00:00.000Z", "2026-03-02T11:00:00.000Z"),
        occurrence("2026-03-09T10:00:00.000Z", "2026-03-09T10:00:00.000Z", "2026-03-09T11:00:00.000Z"),
        occurrence("2026-03-23T10:00:00.000Z", "2026-03-23T10:00:00.000Z", "2026-03-23T11:00:00.000Z"),
        occurrence("2026-03-30T10:00:00.000Z", "2026-03-30T10:00:00.000Z", "2026-03-30T11:00:00.000Z"),
        occurrence("2026-04-06T10:00:00.000Z", "2026-04-06T10:00:00.000Z", "2026-04-06T11:00:00.000Z"),
      ],
      1,
      { eventsAdded: 1, eventsRemoved: 1 },
    );
    expect(harness.findMasterId()).toBe(masterId);

    const restoredIcs = buildCalendar([MASTER]);
    await expectStepAndReplay(
      harness,
      restoredIcs,
      [
        occurrence("2026-03-02T10:00:00.000Z", "2026-03-02T10:00:00.000Z", "2026-03-02T11:00:00.000Z"),
        occurrence("2026-03-09T10:00:00.000Z", "2026-03-09T10:00:00.000Z", "2026-03-09T11:00:00.000Z"),
        occurrence("2026-03-16T10:00:00.000Z", "2026-03-16T10:00:00.000Z", "2026-03-16T11:00:00.000Z"),
        occurrence("2026-03-23T10:00:00.000Z", "2026-03-23T10:00:00.000Z", "2026-03-23T11:00:00.000Z"),
        occurrence("2026-03-30T10:00:00.000Z", "2026-03-30T10:00:00.000Z", "2026-03-30T11:00:00.000Z"),
        occurrence("2026-04-06T10:00:00.000Z", "2026-04-06T10:00:00.000Z", "2026-04-06T11:00:00.000Z"),
      ],
      1,
      { eventsAdded: 1, eventsRemoved: 0 },
    );

    const collisionOverrideA = buildOverride(
      "20260316T100000Z",
      "20260325T120000Z",
      "20260325T130000Z",
      "Collision A",
    );
    const collisionOverrideB = buildOverride(
      "20260323T100000Z",
      "20260325T120000Z",
      "20260325T130000Z",
      "Collision B",
    );
    const collisionIcs = buildCalendar([MASTER, collisionOverrideA, collisionOverrideB]);
    const collisionExpected = [
      occurrence("2026-03-02T10:00:00.000Z", "2026-03-02T10:00:00.000Z", "2026-03-02T11:00:00.000Z"),
      occurrence("2026-03-09T10:00:00.000Z", "2026-03-09T10:00:00.000Z", "2026-03-09T11:00:00.000Z"),
      occurrence("2026-03-16T10:00:00.000Z", "2026-03-25T12:00:00.000Z", "2026-03-25T13:00:00.000Z", "Collision A"),
      occurrence("2026-03-23T10:00:00.000Z", "2026-03-25T12:00:00.000Z", "2026-03-25T13:00:00.000Z", "Collision B"),
      occurrence("2026-03-30T10:00:00.000Z", "2026-03-30T10:00:00.000Z", "2026-03-30T11:00:00.000Z"),
      occurrence("2026-04-06T10:00:00.000Z", "2026-04-06T10:00:00.000Z", "2026-04-06T11:00:00.000Z"),
    ];
    await expectStepAndReplay(
      harness,
      collisionIcs,
      collisionExpected,
      3,
      { eventsAdded: 2, eventsRemoved: 0 },
    );

    const parsedCollision = harness.parseKeeperCalendar();
    const emittedUids = new Set(parsedCollision.events.map((event) => event.uid));
    const emittedRecurrenceIds = parsedCollision.events.flatMap((event) => {
      if (!event.recurrenceId) {
        return [];
      }
      return [event.recurrenceId.value.date.toISOString()];
    });
    expect(emittedUids.size).toBe(1);
    expect(emittedRecurrenceIds).toEqual([
      "2026-03-16T10:00:00.000Z",
      "2026-03-23T10:00:00.000Z",
    ]);

    const reorderedCollisionIcs = buildCalendar([
      collisionOverrideB,
      collisionOverrideA,
      MASTER,
    ]);
    await expectStepAndReplay(
      harness,
      reorderedCollisionIcs,
      collisionExpected,
      3,
      { eventsAdded: 0, eventsRemoved: 0 },
      0,
    );

    const editedRuleIcs = buildCalendar([
      buildMaster("FREQ=WEEKLY;INTERVAL=2;COUNT=4"),
    ]);
    await expectStepAndReplay(
      harness,
      editedRuleIcs,
      [
        occurrence("2026-03-02T10:00:00.000Z", "2026-03-02T10:00:00.000Z", "2026-03-02T11:00:00.000Z"),
        occurrence("2026-03-16T10:00:00.000Z", "2026-03-16T10:00:00.000Z", "2026-03-16T11:00:00.000Z"),
        occurrence("2026-03-30T10:00:00.000Z", "2026-03-30T10:00:00.000Z", "2026-03-30T11:00:00.000Z"),
        occurrence("2026-04-13T10:00:00.000Z", "2026-04-13T10:00:00.000Z", "2026-04-13T11:00:00.000Z"),
      ],
      1,
      { eventsAdded: 1, eventsRemoved: 2 },
    );
    expect(harness.findMasterId()).toBe(masterId);

    const emptyIcs = buildCalendar([]);
    await expectStepAndReplay(
      harness,
      emptyIcs,
      [],
      0,
      { eventsAdded: 0, eventsRemoved: 1 },
    );
  });
});
