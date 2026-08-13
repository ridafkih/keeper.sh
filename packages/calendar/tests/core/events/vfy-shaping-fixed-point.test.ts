import { describe, expect, it } from "vitest";
import {
  isEmptyTimeRange,
  isInvertedTimeRange,
  overlapsRepresentableTimeWindow,
  overlapsTimeWindow,
  REPRESENTABLE_RANGE_SLACK_MS,
  resolveRepresentableTimeRange,
  resolveTimeRangeEnd,
} from "../../../src/core/events/time-range";
import { normalizeCalDAVEvent } from "../../../src/providers/caldav/destination/normalize-event";
import { normalizeGoogleEvent } from "../../../src/providers/google/destination/normalize-event";
import { normalizeOutlookEvent } from "../../../src/providers/outlook/destination/normalize-event";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { MaterializedSyncableEvent } from "../../../src/core/types";

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

/*
 * A deterministic pseudo-random generator so a failure names one seed a rerun reproduces
 * exactly, rather than a case that vanishes on the next run.
 */
const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const BASE_MS = Date.UTC(2027, 2, 8);

const buildEvent = (
  random: () => number,
): MaterializedSyncableEvent => {
  const startOffset = Math.floor((random() - 0.5) * 40 * MS_PER_DAY);
  /*
   * Deliberately weighted towards the degenerate shapes: exactly zero, inverted by a
   * hair, inverted by weeks, sub-second, and ordinary positive spans.
   */
  const kind = Math.floor(random() * 6);
  const startTime = new Date(BASE_MS + startOffset);
  const deltas = [
    0,
    -1,
    -Math.floor(random() * 30 * MS_PER_DAY),
    Math.floor(random() * 1000),
    Math.floor(random() * MS_PER_DAY),
    Math.floor(random() * 5 * MS_PER_DAY),
  ];
  const endTime = new Date(startTime.getTime() + (deltas[kind] ?? 0));

  return {
    availability: "busy",
    calendarId: "calendar",
    endTime,
    isAllDay: random() < 0.5,
    sourceEventId: "source-event",
    startTime,
    summary: "probe",
    uid: "uid",
  } as unknown as MaterializedSyncableEvent;
};

const NORMALIZERS = [
  { label: "CalDAV", normalize: normalizeCalDAVEvent },
  { label: "Google", normalize: normalizeGoogleEvent },
  { label: "Outlook", normalize: normalizeOutlookEvent },
];

const ITERATIONS = 4000;

/*
 * Every destination writes the shaped range, reads it back and shapes the read-back again
 * before deciding whether the mirror still matches. A normalizer that moves a range it has
 * already shaped makes that comparison fail forever: the mirror is rewritten on every run,
 * which is the delete-and-recreate churn this whole change set exists to stop. Convergence
 * therefore has to hold after one application, for every shape a source can state.
 */
describe("destination shaping reaches a fixed point", () => {
  for (const { label, normalize } of NORMALIZERS) {
    it(`settles after one application for ${label}`, () => {
      const random = createRandom(0x5eed_1234);
      for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        const event = buildEvent(random);
        const once = normalize(event);
        const twice = normalize(once);
        const thrice = normalize(twice);

        const describeCase = JSON.stringify({
          isAllDay: event.isAllDay,
          rawEnd: event.endTime.toISOString(),
          rawStart: event.startTime.toISOString(),
        });

        expect(
          { end: twice.endTime.toISOString(), start: twice.startTime.toISOString() },
          `second application moved ${describeCase}`,
        ).toEqual({ end: once.endTime.toISOString(), start: once.startTime.toISOString() });

        expect(
          { end: thrice.endTime.toISOString(), start: thrice.startTime.toISOString() },
          `third application moved ${describeCase}`,
        ).toEqual({ end: once.endTime.toISOString(), start: once.startTime.toISOString() });

        expect(
          createSyncEventContentHash(twice),
          `content hash churned for ${describeCase}`,
        ).toBe(createSyncEventContentHash(once));
      }
    });
  }
});

/*
 * The two destinations that refuse a non-positive span — Google answers "The specified
 * time range is empty." and RFC 5545 requires DTEND to be later than DTSTART — must never
 * be handed one, whatever the source stated.
 */
describe("shaping produces a range the destination accepts", () => {
  for (const { label, normalize } of [NORMALIZERS[0], NORMALIZERS[1]]) {
    it(`never hands ${label} a non-positive span`, () => {
      const random = createRandom(0xc0ff_ee01);
      for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        const event = buildEvent(random);
        const shaped = normalize(event);
        expect(
          shaped.endTime.getTime(),
          `non-positive span from ${event.startTime.toISOString()}/${event.endTime.toISOString()} allDay=${event.isAllDay}`,
        ).toBeGreaterThan(shaped.startTime.getTime());
      }
    });
  }

  it("keeps an all-day span on whole UTC days", () => {
    const random = createRandom(0xda7e_0001);
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const event = buildEvent(random);
      if (!event.isAllDay) {
        continue;
      }
      for (const { label, normalize } of NORMALIZERS) {
        const shaped = normalize(event);
        expect(shaped.startTime.getTime() % MS_PER_DAY, `${label} start off UTC midnight`).toBe(0);
        expect(shaped.endTime.getTime() % MS_PER_DAY, `${label} end off UTC midnight`).toBe(0);
        expect(shaped.endTime.getTime()).toBeGreaterThan(shaped.startTime.getTime());
      }
    }
  });
});

/*
 * A read publishes the shaped span but the database clause can only compare the stored
 * columns, so it widens the window by REPRESENTABLE_RANGE_SLACK_MS and lets the shared
 * predicate decide in memory. If that slack is ever too small the row is never fetched and
 * the event silently disappears from get_events, get_event_count and find_free_time — the
 * exact "misreported by the read APIs" failure. The scan must admit every row the
 * predicate would.
 */
const admittedByScan = (
  event: { endTime: Date; startTime: Date },
  windowStart: Date,
  windowEnd: Date,
): boolean => {
  const scanStart = new Date(windowStart.getTime() - REPRESENTABLE_RANGE_SLACK_MS);
  const scanEnd = new Date(windowEnd.getTime() + REPRESENTABLE_RANGE_SLACK_MS);
  return (
    (event.endTime.getTime() >= scanStart.getTime()
      || event.startTime.getTime() >= scanStart.getTime())
    && event.startTime.getTime() <= scanEnd.getTime()
  );
};

describe("the widened scan reaches every row the read predicate admits", () => {
  it("never drops a row whose published span touches the window", () => {
    const random = createRandom(0xbeef_7777);
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const event = buildEvent(random);
      const windowStart = new Date(BASE_MS + Math.floor((random() - 0.5) * 40 * MS_PER_DAY));
      const windowEnd = new Date(
        windowStart.getTime() + Math.floor(random() * 10 * MS_PER_DAY),
      );

      if (!overlapsRepresentableTimeWindow(event, windowStart, windowEnd)) {
        continue;
      }

      expect(
        admittedByScan(event, windowStart, windowEnd),
        `scan dropped a row the predicate admits: stored ${event.startTime.toISOString()}/${event.endTime.toISOString()} allDay=${event.isAllDay} window ${windowStart.toISOString()}/${windowEnd.toISOString()}`,
      ).toBe(true);
    }
  });
});

/*
 * Ingest, materialization and destination reconciliation each apply a window. An event the
 * earlier layer keeps but a later layer discards is stored and then never mirrored, so the
 * predicates have to agree about a degenerate range rather than one layer treating an
 * inverted span as covering no instant at all.
 */
describe("window membership agrees across the layers that apply one", () => {
  it("admits a degenerate range on the instant it names", () => {
    const random = createRandom(0x1234_abcd);
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const event = buildEvent(random);
      if (!isEmptyTimeRange(event) && !isInvertedTimeRange(event)) {
        continue;
      }

      const windowStart = event.startTime;
      const windowEnd = new Date(event.startTime.getTime() + MS_PER_MINUTE);

      expect(
        overlapsTimeWindow(event, windowStart, windowEnd),
        `ingest dropped a degenerate range on its own instant: ${event.startTime.toISOString()}/${event.endTime.toISOString()}`,
      ).toBe(true);

      expect(
        resolveTimeRangeEnd(event).getTime(),
        "a degenerate range must reach the instant it names",
      ).toBe(event.startTime.getTime());
    }
  });
});
