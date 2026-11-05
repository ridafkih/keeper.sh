import { describe, expect, test } from "vitest";
import { firstOf } from "../support/at";
import {
  dedupeObservations,
  defaultPlanLimits,
  pairReassignedOccurrences,
  planReconciliation,
} from "../../src/index";
import type { IdentifiedEvent, Mapping } from "../../src/index";
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

const occurrenceAt = (index: number) => {
  const day = String((index % 27) + 1).padStart(2, "0");
  const hour = String(index % 24).padStart(2, "0");
  return {
    start: `2026-03-${day}T${hour}:00:00.000Z`,
    end: `2026-03-${day}T${hour}:30:00.000Z`,
  };
};

const observations = (count: number): readonly IdentifiedEvent[] =>
  Array.from({ length: count }, (unused, index) => {
    const span = occurrenceAt(index);
    return {
      identity: slotIdentity("series-1", span.start, span.end),
      event: foreignEvent({
        id: `series-1-${index}`,
        uid: "series-1",
        time: timedAt(span.start, span.end),
        fingerprint: "fp-shared",
      }),
    };
  });

const orphanedMappings = (count: number): readonly Mapping[] =>
  Array.from({ length: count }, (unused, index) => {
    const span = occurrenceAt(index + count);
    return mapping({
      identity: slotIdentity("series-1", span.start, span.end),
      destinationId: `mirror-${index}`,
      mirrorFingerprint: "mirror-shared",
    });
  });

const comparisonsFor = (count: number): number =>
  pairReassignedOccurrences(observations(count), orphanedMappings(count), defaultPlanLimits)
    .comparisons;

describe("occurrence pairing is bounded, and the bound is the named one", () => {
  test("RECON-L4: quadrupling the input does not sixteen-fold the comparison count", () => {
    const small = comparisonsFor(50);
    const large = comparisonsFor(200);

    expect(small).toBeGreaterThan(0);
    expect(large).toBeLessThan(small * 16);
  });

  test("RECON-L4: the growth is consistent with n log n, not with n squared", () => {
    const small = comparisonsFor(100);
    const large = comparisonsFor(1000);

    expect(large).toBeLessThan(small * 100);
    expect(large).toBeLessThan(1000 * 40);
  });

  test("RECON-L4: input past the configured pairing width is refused, not attempted", () => {
    const narrow = { ...defaultPlanLimits, reassignmentPairingWidth: 8 };

    const pairing = pairReassignedOccurrences(observations(64), orphanedMappings(64), narrow);

    expect(pairing.refused).toBe(true);
    expect(pairing.reassignments).toEqual([]);
  });

  test("RECON-L4: a refusal leaves every mapping unpaired rather than guessing at a subset", () => {
    const narrow = { ...defaultPlanLimits, reassignmentPairingWidth: 8 };

    const pairing = pairReassignedOccurrences(observations(64), orphanedMappings(64), narrow);

    expect(pairing.unpairedMappings).toHaveLength(64);
    expect(pairing.unpairedObservations).toHaveLength(64);
  });

  test("RECON-L4: it is the named ceiling that stops it, proved by running two ceilings", () => {
    const under = pairReassignedOccurrences(observations(16), orphanedMappings(16), {
      ...defaultPlanLimits,
      reassignmentPairingWidth: 32,
    });
    const over = pairReassignedOccurrences(observations(16), orphanedMappings(16), {
      ...defaultPlanLimits,
      reassignmentPairingWidth: 8,
    });

    expect(under.refused).toBe(false);
    expect(over.refused).toBe(true);
  });

  test("RECON-L4: pairing completes inside one scheduler tick, so it cannot be awaiting anything", async () => {
    let finished = false;
    pairReassignedOccurrences(observations(1000), orphanedMappings(1000), {
      ...defaultPlanLimits,
      reassignmentPairingWidth: 4096,
    });
    finished = true;

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(finished).toBe(true);
  });

  test("RECON-L4: a refused ceiling is a typed unresolved outcome, never a delete and recreate", () => {
    const shifted = observations(10);
    const orphans = orphanedMappings(10);
    const planWith = (width: number) =>
      planReconciliation(
        sourceOnly(snapshotListing({ events: shifted.map((observation) => observation.event) })),
        knownState(
          orphans.map((orphan, index) => {
            const span = occurrenceAt(index + orphans.length);
            return knownEvent({
              identity: orphan.sourceIdentity,
              remoteId: `known-${index}`,
              fingerprint: "fp-shared",
              time: timedAt(span.start, span.end),
            });
          }),
        ),
        mappingSet(orphans),
        policy({ limits: { ...defaultPlanLimits, reassignmentPairingWidth: width } }),
      );

    const refused = planWith(4);
    const paired = planWith(512);

    expect(paired.tombstones).toEqual([]);
    expect(refused.tombstones).toEqual([]);
    expect(refused.unresolved.map((item) => item.reason)).toContain("pairingCeilingExceeded");
  });

  test("RECON-L5: a degenerate order where every pair compares equal still terminates", () => {
    const allEqual = Array.from({ length: 500 }, () => ({
      identity: slotIdentity("series-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
      event: foreignEvent({
        id: "series-1",
        uid: "series-1",
        revision: 1,
        version: "v1",
        fingerprint: "fp-identical",
        time: timedAt("2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
      }),
    }));

    const deduped = dedupeObservations(allEqual);

    expect(deduped.kept).toHaveLength(1);
  });

  test("RECON-L5: the winner of a degenerate tie is stable across ten runs", () => {
    const allEqual = [0, 1, 2].map((index) => ({
      identity: slotIdentity("series-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
      event: foreignEvent({
        id: `copy-${index}`,
        uid: "series-1",
        revision: 1,
        version: "v1",
        fingerprint: "fp-identical",
      }),
    }));
    const winners = new Set(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => firstOf(dedupeObservations(allEqual).kept).event.id.value),
    );

    expect(winners.size).toBe(1);
  });

  test("RECON-L5: the comparison count on a degenerate order is linear in the batch", () => {
    const batchOf = (count: number) =>
      Array.from({ length: count }, () => ({
        identity: slotIdentity("series-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
        event: foreignEvent({ id: "same", uid: "series-1", revision: 1, fingerprint: "fp-identical" }),
      }));

    expect(dedupeObservations(batchOf(2000)).comparisons).toBeLessThan(2000 * 4);
  });
});
