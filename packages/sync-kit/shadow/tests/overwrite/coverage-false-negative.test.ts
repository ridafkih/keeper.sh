import { describe, expect, test } from "vitest";
import type { DestinationSyncInput } from "../../src/index";
import { cataloged, runShadow } from "../support/scenario";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedCoverage,
  syncInput,
} from "../support/fixtures";

const orphan = slotIdentity("evt-gone", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const baseInput = (recordedAt: string | null): DestinationSyncInput =>
  syncInput({
    storedSourceEvents: [],
    mirrors: [
      mirrorRow({
        identity: orphan,
        destinationId: "mirror-evt-gone",
        destinationHandle: "handle-evt-gone",
      }),
    ],
    destinationListing: destinationSnapshot({
      events: [
        ownMirrorEvent({
          id: "mirror-evt-gone",
          uid: "evt-gone",
          deleteHandle: "handle-evt-gone",
        }),
      ],
    }),
    storedCoverage: [storedCoverage({ recordedAt })],
  });

describe("a proof present and a proof absent must not read the same", () => {
  test("SHADOW-O2: a proof present and a proof absent differ only in the proof", () => {
    const withProof = cataloged(runShadow(baseInput("2026-06-15T11:30:00.000Z"), shadowOptions()));
    const withoutProof = cataloged(runShadow(baseInput(null), shadowOptions()));

    expect(withoutProof.deletions.length).toBe(0);
    expect(withProof.deletions.length).toBe(1);
    expect(withProof.deletions.length).not.toBe(withoutProof.deletions.length);
  });

  test("SHADOW-O2: the proven run's deletion is licensed by proven coverage", () => {
    const withProof = cataloged(runShadow(baseInput("2026-06-15T11:30:00.000Z"), shadowOptions()));

    for (const entry of withProof.deletions) {
      expect(entry.licensedBy).toBe("proven");
      expect(entry.uid.value).toBe("evt-gone");
    }
  });

  test("SHADOW-O2: the two runs differ in coverage verdict as well as in deletions", () => {
    const withProof = cataloged(runShadow(baseInput("2026-06-15T11:30:00.000Z"), shadowOptions()));
    const withoutProof = cataloged(runShadow(baseInput(null), shadowOptions()));

    expect(withProof.coverage.map((verdict) => verdict.kind)).toEqual(["proven"]);
    expect(withoutProof.coverage.map((verdict) => verdict.kind)).toEqual(["unproven"]);
    expect(withProof.coverage.map((verdict) => verdict.listingKind)).toEqual(["snapshot"]);
    expect(withoutProof.coverage.map((verdict) => verdict.listingKind)).toEqual(["partial"]);
  });
});
