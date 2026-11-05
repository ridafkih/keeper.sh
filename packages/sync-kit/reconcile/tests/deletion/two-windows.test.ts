import { describe, expect, test } from "vitest";
import { firstOf } from "../support/at";
import { planReconciliation } from "../../src/index";
import {
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  slotIdentity,
  snapshotListing,
  sourceOnly,
  timedAt,
} from "../support/fixtures";
import { instant } from "../support/fixtures";

const insideCoverageOutsideMirror = {
  start: "2026-02-01T09:00:00.000Z",
  end: "2026-02-01T10:00:00.000Z",
};

const narrowMirrorWindow = {
  start: instant("2026-03-01T00:00:00.000Z"),
  end: instant("2026-04-01T00:00:00.000Z"),
};

const strayIdentity = slotIdentity(
  "evt-outside",
  insideCoverageOutsideMirror.start,
  insideCoverageOutsideMirror.end,
);

const strayEvent = () =>
  foreignEvent({
    id: "evt-outside",
    uid: "evt-outside",
    time: timedAt(insideCoverageOutsideMirror.start, insideCoverageOutsideMirror.end),
  });

const scenario = () => ({
  observed: sourceOnly(snapshotListing({ events: [strayEvent()] })),
  known: knownState([
    knownEvent({
      identity: strayIdentity,
      time: timedAt(insideCoverageOutsideMirror.start, insideCoverageOutsideMirror.end),
    }),
  ]),
  mappings: mappingSet([mapping({ identity: strayIdentity, destinationId: "mirror-outside" })]),
  policy: policy({ mirrorWindow: narrowMirrorWindow }),
});

describe("the requested window and the authoritative window are different powers", () => {
  test("RECON-O7: an event inside proven coverage but outside the mirror window retires the mirror", () => {
    const built = scenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, built.policy);

    expect(plan.tombstones).toHaveLength(1);
    expect(firstOf(plan.tombstones).cause).toBe("outsideMirrorWindow");
  });

  test("RECON-O7: the source baseline row is never dropped by a mirror-window retirement", () => {
    const built = scenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, built.policy);

    expect(plan.tombstones.map((tombstone) => tombstone.cause)).not.toContain("absentFromSnapshot");
    expect(plan.unresolved).toEqual([]);
  });

  test("RECON-O7: no identity ever carries both an absence cause and a window cause", () => {
    const built = scenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, built.policy);
    const causesByIdentity = new Map<string, number>();
    for (const tombstone of plan.tombstones) {
      const key = tombstone.identity.uid.value;
      causesByIdentity.set(key, (causesByIdentity.get(key) ?? 0) + 1);
    }

    for (const count of causesByIdentity.values()) {
      expect(count).toBe(1);
    }
  });

  test("RECON-O7: widening the mirror window to contain the event withdraws the retirement", () => {
    const built = scenario();
    const wide = policy({
      mirrorWindow: { start: instant("2026-01-01T00:00:00.000Z"), end: instant("2026-12-31T00:00:00.000Z") },
    });

    const plan = planReconciliation(built.observed, built.known, built.mappings, wide);

    expect(plan.tombstones).toEqual([]);
  });
});
