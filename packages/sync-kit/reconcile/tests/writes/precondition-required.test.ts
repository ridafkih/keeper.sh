import type { PlannedWrite } from "../../src/index";
import { describe, expect, test } from "vitest";
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

const spanFor = (index: number) => ({
  start: `2026-03-1${index}T09:00:00.000Z`,
  end: `2026-03-1${index}T10:00:00.000Z`,
});

const identities = [1, 2, 3, 4, 5, 6].map((index) =>
  slotIdentity(`evt-${index}`, spanFor(index).start, spanFor(index).end),
);

const busyScenario = () => ({
  observed: sourceOnly(
    snapshotListing({
      events: [1, 2, 3, 4].map((index) =>
        foreignEvent({
          id: `evt-${index}`,
          uid: `evt-${index}`,
          time: timedAt(spanFor(index).start, spanFor(index).end),
          fingerprint: `fp-changed-${index}`,
        }),
      ),
    }),
  ),
  known: knownState(identities.slice(0, 5).map((identity) => knownEvent({ identity }))),
  mappings: mappingSet(
    identities.slice(0, 3).map((identity, index) => mapping({ identity, destinationId: `mirror-${index}` })),
  ),
});

const preconditionsOf = (write: PlannedWrite): readonly string[] => {
  if (write.kind === "replace") {
    return [write.retire.precondition.kind, write.recreate.precondition.kind];
  }
  return [write.intent.precondition.kind];
};

describe("every write in a real plan carries its precondition", () => {
  test("RECON-O9: a plan over a busy state produces writes at all", () => {
    const built = busyScenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());

    expect(plan.writes.length).toBeGreaterThan(0);
  });

  test("RECON-O9: no write in the plan carries a missing precondition", () => {
    const built = busyScenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());

    for (const write of plan.writes) {
      for (const kind of preconditionsOf(write)) {
        expect(["matchesVersion", "matchesFingerprint", "absent"]).toContain(kind);
      }
    }
  });

  test("RECON-O9: every mutating write carries an observed precondition, never absent", () => {
    const built = busyScenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());
    const mutating = plan.writes.filter((write) => write.kind === "single" && write.intent.kind !== "create");

    for (const write of mutating) {
      expect(preconditionsOf(write)).not.toContain("absent");
    }
  });

  test("RECON-O9: the precondition a write carries is the one the mapping recorded", () => {
    const built = busyScenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());
    const recorded = new Set(
      built.mappings.entries.map((entry) => JSON.stringify(entry.precondition)),
    );
    const updates = plan.writes.filter((write) => write.kind === "single" && write.intent.kind === "update");

    for (const write of updates) {
      expect(recorded.has(JSON.stringify(write.intent?.precondition))).toBe(true);
    }
  });
});
