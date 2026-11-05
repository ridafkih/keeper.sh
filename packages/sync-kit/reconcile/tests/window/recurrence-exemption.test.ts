import { describe, expect, test } from "vitest";
import { firstOf } from "../support/at";
import { planReconciliation } from "../../src/index";
import {
  instant,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  masterIdentity,
  recurringEvent,
  snapshotListing,
  sourceOnly,
  timedAt,
} from "../support/fixtures";

const seriesIdentity = masterIdentity("weekly-standup");

const anchoredTwoYearsBeforeTheWindow = () =>
  recurringEvent(
    { id: "weekly-standup", uid: "weekly-standup", fingerprint: "fp-series" },
    "2024-01-08T09:00:00.000Z",
    "FREQ=WEEKLY;BYDAY=MO",
  );

const narrowWindow = {
  start: instant("2026-03-01T00:00:00.000Z"),
  end: instant("2026-04-01T00:00:00.000Z"),
};

const knownSeries = () =>
  knownState([
    knownEvent({
      identity: seriesIdentity,
      recurring: true,
      fingerprint: "fp-series",
      time: timedAt("2024-01-08T09:00:00.000Z", "2024-01-08T10:00:00.000Z"),
    }),
  ]);

const mapped = () =>
  mappingSet([
    mapping({ identity: seriesIdentity, destinationId: "mirror-series", sourceFingerprint: "fp-series" }),
  ]);

describe("a master anchored before the window is not out of window", () => {
  test("RECON-O30: a master with DTSTART two years early is not retired", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [anchoredTwoYearsBeforeTheWindow()] })),
      knownSeries(),
      mapped(),
      policy({ mirrorWindow: narrowWindow }),
    );

    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O30: nor is it reported as outside proven coverage", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [anchoredTwoYearsBeforeTheWindow()] })),
      knownSeries(),
      mapped(),
      policy({ mirrorWindow: narrowWindow }),
    );

    expect(plan.unresolved).toEqual([]);
  });

  test("RECON-I34: a non-recurring event with the same early anchor IS retired", () => {
    const singleIdentity = masterIdentity("one-off");

    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [] })),
      knownState([
        knownEvent({
          identity: singleIdentity,
          recurring: false,
          time: timedAt("2024-01-08T09:00:00.000Z", "2024-01-08T10:00:00.000Z"),
        }),
      ]),
      mappingSet([mapping({ identity: singleIdentity, destinationId: "mirror-one-off" })]),
      policy({ mirrorWindow: narrowWindow }),
    );

    expect(plan.tombstones.map((tombstone) => tombstone.cause)).not.toEqual([]);
  });

  test("RECON-O30: the series' absence from a snapshot still tombstones it, exemption is about the window only", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [] })),
      knownSeries(),
      mapped(),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(1);
    expect(firstOf(plan.tombstones).cause).toBe("absentFromSnapshot");
  });
});
