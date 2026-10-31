import { describe, expect, test } from "vitest";
import { at, firstOf } from "../support/at";
import { defaultPlanLimits, pairReassignedOccurrences, planReconciliation } from "../../src/index";
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
  sourceOnly,
  timedAt,
} from "../support/fixtures";

const occurrenceSpan = (index: number) => ({
  start: `2026-03-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`,
  end: `2026-03-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
});

const tenOccurrences = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => {
  const span = occurrenceSpan(index);
  return { index, span, identity: slotIdentity("series-1", span.start, span.end) };
});

const mappedSeries = () =>
  mappingSet(
    tenOccurrences.map((occurrence) =>
      mapping({
        identity: occurrence.identity,
        destinationId: `mirror-${occurrence.index}`,
        sourceFingerprint: "fp-shared",
        mirrorFingerprint: `mirror-shared`,
      }),
    ),
  );

const knownSeries = () =>
  knownState(
    tenOccurrences.map((occurrence) =>
      knownEvent({
        identity: occurrence.identity,
        recurring: true,
        fingerprint: "fp-shared",
        time: timedAt(occurrence.span.start, occurrence.span.end),
      }),
    ),
  );

const listingMissingTheFirstOccurrence = () =>
  snapshotListing({
    events: tenOccurrences.slice(1).map((occurrence) =>
      foreignEvent({
        id: `series-1-${occurrence.index}`,
        uid: "series-1",
        time: timedAt(occurrence.span.start, occurrence.span.end),
        fingerprint: "fp-shared",
      }),
    ),
  });

describe("removing an early occurrence must not rewrite the whole series", () => {
  test("RECON-O34: one removed occurrence retires exactly one mirror", () => {
    const plan = planReconciliation(
      sourceOnly(listingMissingTheFirstOccurrence()),
      knownSeries(),
      mappedSeries(),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(1);
  });

  test("RECON-O34: the nine surviving occurrences keep their existing mappings, so no writes are planned", () => {
    const plan = planReconciliation(
      sourceOnly(listingMissingTheFirstOccurrence()),
      knownSeries(),
      mappedSeries(),
      policy(),
    );

    expect(plan.writes).toEqual([]);
  });

  test("RECON-O34: the retired mirror is the one that belonged to the removed occurrence", () => {
    const plan = planReconciliation(
      sourceOnly(listingMissingTheFirstOccurrence()),
      knownSeries(),
      mappedSeries(),
      policy(),
    );

    expect(firstOf(plan.tombstones).identity).toEqual(firstOf(tenOccurrences).identity);
  });

  test("RECON-I35: pairing never crosses from one series into another", () => {
    const observation = {
      identity: at(tenOccurrences, 1).identity,
      event: foreignEvent({ id: "series-1-1", uid: "series-1", fingerprint: "fp-shared" }),
    };
    const divergentMapping = mapping({
      identity: slotIdentity(
        "series-2",
        firstOf(tenOccurrences).span.start,
        firstOf(tenOccurrences).span.end,
      ),
      destinationId: "mirror-0",
      mirrorFingerprint: "mirror-different",
    });

    const pairing = pairReassignedOccurrences([observation], [divergentMapping], defaultPlanLimits);

    expect(pairing.reassignments).toEqual([]);
    expect(pairing.unpairedMappings).toEqual([divergentMapping]);
  });

  test("RECON-I35: an orphan inside the series does pair, producing a reassignment not a delete", () => {
    const observation = {
      identity: at(tenOccurrences, 1).identity,
      event: foreignEvent({ id: "series-1-1", uid: "series-1", fingerprint: "fp-shared" }),
    };
    const matchingMapping = mapping({
      identity: firstOf(tenOccurrences).identity,
      destinationId: "mirror-0",
      mirrorFingerprint: "mirror-shared",
    });

    const pairing = pairReassignedOccurrences([observation], [matchingMapping], defaultPlanLimits);

    expect(pairing.reassignments).toHaveLength(1);
    expect(pairing.unpairedMappings).toEqual([]);
  });

  test("RECON-O34: a reassignment onto a mirror the user edited is a conflict, not an update", () => {
    const slotA = firstOf(tenOccurrences).identity;
    const shifted = at(tenOccurrences, 1);

    const plan = planReconciliation(
      bothSides(
        snapshotListing({
          events: [
            foreignEvent({
              id: "series-1-b",
              uid: "series-1",
              fingerprint: "fp-moved",
              time: timedAt(shifted.span.start, shifted.span.end),
            }),
          ],
        }),
        snapshotListing({
          events: [
            ownedEvent(
              {
                id: "mirror-a",
                uid: "mirror-a",
                fingerprint: "edited-by-the-user",
                calendar: destinationCalendar,
                version: "v-mirror-a-1",
              },
              ourInstallation,
            ),
          ],
          scope: destinationScope,
        }),
      ),
      knownState([knownEvent({ identity: slotA, remoteId: "series-1-a", fingerprint: "fp-shared" })]),
      mappingSet([
        mapping({
          identity: slotA,
          destinationId: "mirror-a",
          sourceFingerprint: "fp-shared",
          mirrorFingerprint: "mirror-as-written",
        }),
      ]),
      policy(),
    );

    expect(plan.writes).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(firstOf(plan.conflicts).observed).toEqual({
      kind: "matchesVersion",
      version: { kind: "remoteVersion", value: "v-mirror-a-1" },
    });
  });

  test("RECON-O34: an untouched mirror still takes the reassignment", () => {
    const slotA = firstOf(tenOccurrences).identity;
    const shifted = at(tenOccurrences, 1);

    const plan = planReconciliation(
      bothSides(
        snapshotListing({
          events: [
            foreignEvent({
              id: "series-1-b",
              uid: "series-1",
              fingerprint: "fp-moved",
              time: timedAt(shifted.span.start, shifted.span.end),
            }),
          ],
        }),
        snapshotListing({
          events: [
            ownedEvent(
              {
                id: "mirror-a",
                uid: "mirror-a",
                fingerprint: "mirror-as-written",
                calendar: destinationCalendar,
                version: "v-mirror-a-1",
              },
              ourInstallation,
            ),
          ],
          scope: destinationScope,
        }),
      ),
      knownState([knownEvent({ identity: slotA, remoteId: "series-1-a", fingerprint: "fp-shared" })]),
      mappingSet([
        mapping({
          identity: slotA,
          destinationId: "mirror-a",
          sourceFingerprint: "fp-shared",
          mirrorFingerprint: "mirror-as-written",
        }),
      ]),
      policy(),
    );

    expect(plan.conflicts).toEqual([]);
    expect(plan.writes.map((write) => write.intent?.kind)).toEqual(["update"]);
  });
});
