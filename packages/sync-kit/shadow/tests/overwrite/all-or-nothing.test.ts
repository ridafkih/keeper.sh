import { describe, expect, test } from "vitest";
import { cataloged, runShadow } from "../support/scenario";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  sourceCalendarA,
  sourceCalendarB,
  storedCoverage,
  syncInput,
  witnessFor,
} from "../support/fixtures";

const orphanA = slotIdentity("evt-a-gone", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const orphanB = slotIdentity("evt-b-gone", "2026-03-11T09:00:00.000Z", "2026-03-11T10:00:00.000Z");

const mapped = [sourceCalendarA, sourceCalendarB];

const freshlyImportedSibling = () =>
  syncInput({
    mappedSourceCalendars: mapped,
    witness: witnessFor(mapped),
    storedSourceEvents: [],
    mirrors: [
      mirrorRow({
        identity: orphanA,
        sourceCalendar: sourceCalendarA,
        destinationId: "mirror-evt-a-gone",
        destinationHandle: "handle-evt-a-gone",
      }),
      mirrorRow({
        identity: orphanB,
        sourceCalendar: sourceCalendarB,
        destinationId: "mirror-evt-b-gone",
        destinationHandle: "handle-evt-b-gone",
      }),
    ],
    destinationListing: destinationSnapshot({
      events: [
        ownMirrorEvent({
          id: "mirror-evt-a-gone",
          uid: "evt-a-gone",
          deleteHandle: "handle-evt-a-gone",
        }),
        ownMirrorEvent({
          id: "mirror-evt-b-gone",
          uid: "evt-b-gone",
          deleteHandle: "handle-evt-b-gone",
        }),
      ],
    }),
    storedCoverage: [
      storedCoverage({ calendar: sourceCalendarA }),
      storedCoverage({ calendar: sourceCalendarB, ingestWindowStart: null, ingestWindowEnd: null }),
    ],
  });

describe("a freshly imported calendar cannot delete another's mirrors", () => {
  test("SHADOW-O4: a second source with no recorded coverage cannot license the first source's deletions", () => {
    const catalog = cataloged(runShadow(freshlyImportedSibling(), shadowOptions()));

    expect(catalog.deletions).toEqual([]);
    expect(catalog.coverage.length).toBe(2);
    for (const verdict of catalog.coverage) {
      expect(verdict.kind).toBe("unproven");
      expect(verdict.listingKind).toBe("partial");
    }
  });

  test("SHADOW-O4: the unprovable source is named, not skipped", () => {
    const catalog = cataloged(runShadow(freshlyImportedSibling(), shadowOptions()));
    const refusals = catalog.coverage.map((verdict) => verdict.refusal);

    expect(refusals).toContain("noRecordedIngestWindow");
    expect(refusals).toContain("siblingSourceUnproven");
  });

  test("SHADOW-O4: zero mapped sources refuses rather than proving nothing over everything", () => {
    const catalog = runShadow(
      syncInput({
        mappedSourceCalendars: [],
        witness: witnessFor([]),
        storedCoverage: [],
        mirrors: [mirrorRow({ identity: orphanA })],
      }),
      shadowOptions(),
    );

    expect(catalog.kind).toBe("notTranslated");
    if (catalog.kind !== "notTranslated") {
      throw new Error("expected a refusal");
    }
    expect(catalog.reason).toBe("noMappedSourceCalendars");
  });
});
