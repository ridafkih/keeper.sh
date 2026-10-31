import { describe, expect, test } from "vitest";
import { at, firstOf } from "../support/at";
import { defaultWindowMembership, insideProvenCoverage, planReconciliation } from "../../src/index";
import {
  instant,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  provenWindows,
  slotIdentity,
  snapshotListing,
  sourceOnly,
  timedAt,
  unprovenPolicy,
} from "../support/fixtures";

const insideBoth = { start: "2026-03-10T09:00:00.000Z", end: "2026-03-10T10:00:00.000Z" };

const identity = slotIdentity("evt-covered", insideBoth.start, insideBoth.end);

const baseline = () => ({
  observed: sourceOnly(snapshotListing({ events: [] })),
  known: knownState([
    knownEvent({ identity, time: timedAt(insideBoth.start, insideBoth.end) }),
  ]),
  mappings: mappingSet([mapping({ identity, destinationId: "mirror-covered" })]),
});

const gapIdentity = slotIdentity(
  "evt-gap",
  "2026-12-20T09:00:00.000Z",
  "2026-12-20T10:00:00.000Z",
);

describe("absence licenses a deletion only inside proven coverage", () => {
  test("RECON-O4: identical inputs under unproven coverage tombstone nothing", () => {
    const built = baseline();

    const plan = planReconciliation(built.observed, built.known, built.mappings, unprovenPolicy());

    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-O4: the same absence is reported as unresolved rather than silently dropped", () => {
    const built = baseline();

    const plan = planReconciliation(built.observed, built.known, built.mappings, unprovenPolicy());

    expect(plan.unresolved.map((item) => item.reason)).toContain("outsideProvenCoverage");
  });

  test("RECON-O4: the identical inputs under proven coverage tombstone exactly one", () => {
    const built = baseline();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());

    expect(plan.tombstones).toHaveLength(1);
    expect(firstOf(plan.tombstones).cause).toBe("absentFromSnapshot");
  });

  test("RECON-O5: an event in the gap between recorded coverage and the requested edge is neither deleted nor re-added", () => {
    const gapCoverage = {
      kind: "proven" as const,
      calendar: provenWindows.calendar,
      historic: provenWindows.historic,
      future: {
        start: instant("2026-06-01T00:00:00.000Z"),
        end: instant("2026-12-01T00:00:00.000Z"),
      },
    };

    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [] })),
      knownState([
        knownEvent({
          identity: gapIdentity,
          time: timedAt("2026-12-20T09:00:00.000Z", "2026-12-20T10:00:00.000Z"),
        }),
      ]),
      mappingSet([mapping({ identity: gapIdentity, destinationId: "mirror-gap" })]),
      policy({ coverage: gapCoverage }),
    );

    expect(plan.tombstones).toEqual([]);
    expect(plan.writes).toEqual([]);
    expect(plan.unresolved.map((item) => item.reason)).toEqual(["outsideProvenCoverage"]);
  });

  test("RECON-O4: unproven coverage answers false for any event whatsoever", () => {
    expect(
      insideProvenCoverage(
        { kind: "unproven" },
        timedAt(insideBoth.start, insideBoth.end),
        defaultWindowMembership,
      ),
    ).toBe(false);
  });

  test("RECON-O4: proven coverage answers true for an event squarely inside an axis", () => {
    expect(
      insideProvenCoverage(
        provenWindows,
        timedAt(insideBoth.start, insideBoth.end),
        defaultWindowMembership,
      ),
    ).toBe(true);
  });

  test("RECON-O4: a source calendar with no coverage entry at all is treated as unproven", () => {
    const built = baseline();
    const noEntries = { ...policy(), coverageBySource: new Map() };

    const plan = planReconciliation(built.observed, built.known, built.mappings, noEntries);

    expect(plan.tombstones).toEqual([]);
  });
});
