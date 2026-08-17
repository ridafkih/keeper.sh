import type { ConflictCause } from "../../src/index";
import { describe, expect, test } from "vitest";
import { firstOf } from "../support/at";
import { classifyConflict, conflictCauses, planReconciliation } from "../../src/index";
import {
  bothSides,
  destinationCalendar,
  destinationScope,
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  ourInstallation,
  ownedEvent,
  policy,
  slotIdentity,
  snapshotListing,
  timedAt,
} from "../support/fixtures";

const identity = slotIdentity("evt-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const mappingAtVersionOne = () =>
  mapping({ identity, destinationId: "mirror-1", version: "v1", sourceFingerprint: "fp-old" });

const mirrorAtVersionTwo = () =>
  ownedEvent(
    {
      id: "mirror-1",
      uid: "mirror-1",
      version: "v2",
      calendar: destinationCalendar,
      fingerprint: "mirror-edited",
    },
    ourInstallation,
  );

const editedSource = () => foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-new" });

const scenario = () => ({
  observed: bothSides(
    snapshotListing({ events: [editedSource()] }),
    snapshotListing({ events: [mirrorAtVersionTwo()], scope: destinationScope }),
  ),
  known: knownState([knownEvent({ identity, fingerprint: "fp-old" })]),
  mappings: mappingSet([mappingAtVersionOne()]),
});

describe("a stale precondition never becomes a silent clobber", () => {
  test("RECON-O10: a mapping recorded at v1 against an observed v2 yields a conflict", () => {
    const built = scenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());

    expect(plan.conflicts).toHaveLength(1);
  });

  test("RECON-O10: that conflict suppresses the write entirely", () => {
    const built = scenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());

    expect(plan.writes).toEqual([]);
  });

  test("RECON-O10: the conflict carries both the expected and the observed precondition", () => {
    const built = scenario();

    const plan = planReconciliation(built.observed, built.known, built.mappings, policy());

    expect(firstOf(plan.conflicts).expected).toEqual({
      kind: "matchesVersion",
      version: { kind: "remoteVersion", value: "v1" },
    });
    expect(firstOf(plan.conflicts).observed).toEqual({
      kind: "matchesVersion",
      version: { kind: "remoteVersion", value: "v2" },
    });
  });

  test("RECON-O10: a matching precondition is not a conflict and does produce the write", () => {
    const built = scenario();
    const agreeing = mappingSet([
      mapping({ identity, destinationId: "mirror-1", version: "v2", sourceFingerprint: "fp-old" }),
    ]);

    const plan = planReconciliation(built.observed, built.known, agreeing, policy());

    expect(plan.conflicts).toEqual([]);
    expect(plan.writes).toHaveLength(1);
  });

  test("RECON-O11: the six conflict causes are distinct and none is a catch-all", () => {
    expect(new Set(conflictCauses).size).toBe(6);
    expect(conflictCauses).not.toContain("changed");
  });

  const causeCases: readonly (readonly [ConflictCause, () => ReturnType<typeof classifyConflict>])[] = [
    [
      "sourceChanged",
      () =>
        classifyConflict(
          mapping({ identity, destinationId: "mirror-1", sourceFingerprint: "fp-old" }),
          foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-new" }),
          ownedEvent({ id: "mirror-1", uid: "mirror-1", fingerprint: "mirror-evt-1" }, ourInstallation),
        ),
    ],
    [
      "mirrorContentChanged",
      () =>
        classifyConflict(
          mapping({ identity, destinationId: "mirror-1", mirrorFingerprint: "mirror-evt-1" }),
          foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-evt-1" }),
          ownedEvent(
            { id: "mirror-1", uid: "mirror-1", fingerprint: "mirror-hand-edited", title: "edited by a human" },
            ourInstallation,
          ),
        ),
    ],
    [
      "mirrorTimeChanged",
      () =>
        classifyConflict(
          mapping({ identity, destinationId: "mirror-1", mirrorFingerprint: "mirror-evt-1" }),
          foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-evt-1" }),
          ownedEvent(
            {
              id: "mirror-1",
              uid: "mirror-1",
              fingerprint: "mirror-moved",
              time: timedAt("2026-03-10T14:00:00.000Z", "2026-03-10T15:00:00.000Z"),
            },
            ourInstallation,
          ),
        ),
    ],
    [
      "mirrorAvailabilityChanged",
      () =>
        classifyConflict(
          mapping({ identity, destinationId: "mirror-1", mirrorFingerprint: "mirror-evt-1" }),
          foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-evt-1" }),
          ownedEvent(
            { id: "mirror-1", uid: "mirror-1", fingerprint: "mirror-free", availability: "free" },
            ourInstallation,
          ),
        ),
    ],
    [
      "mirrorMissing",
      () =>
        classifyConflict(
          mapping({ identity, destinationId: "mirror-1" }),
          foreignEvent({ id: "evt-1", uid: "evt-1" }),
          null,
        ),
    ],
    [
      "mirrorReassigned",
      () =>
        classifyConflict(
          mapping({ identity, destinationId: "mirror-1" }),
          foreignEvent({ id: "evt-1", uid: "evt-1" }),
          ownedEvent({ id: "mirror-elsewhere", uid: "mirror-elsewhere" }, ourInstallation),
        ),
    ],
  ];

  for (const entry of causeCases) {
    const [expectedCause, build] = entry;
    test(`RECON-O11: ${expectedCause} is classified as itself, not collapsed`, () => {
      expect(build()?.cause).toBe(expectedCause);
    });
  }
});
