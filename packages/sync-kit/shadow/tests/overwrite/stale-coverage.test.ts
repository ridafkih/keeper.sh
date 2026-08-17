import { describe, expect, test } from "vitest";
import { sourceCoverageFrom } from "../../src/index";
import { cataloged, runShadow } from "../support/scenario";
import {
  asOf,
  destinationSnapshot,
  mirrorRow,
  mirrorWindow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedCoverage,
  syncInput,
} from "../support/fixtures";

const orphan = slotIdentity("evt-gone", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const weeksOldButOtherwiseValid = () =>
  storedCoverage({ recordedAt: "2026-05-01T00:00:00.000Z" });

const staleInput = () =>
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
    storedCoverage: [weeksOldButOtherwiseValid()],
  });

describe("coverage recorded weeks ago is not proof of present absence", () => {
  test("SHADOW-O19: an otherwise valid row past the age bound proves nothing", () => {
    const proof = sourceCoverageFrom({
      stored: weeksOldButOtherwiseValid(),
      mirrorWindow,
      asOf,
      maxCoverageAgeSeconds: 86_400,
    });

    expect(proof.kind).toBe("unproven");
    if (proof.kind !== "unproven") {
      throw new Error("expected an unproven proof");
    }
    expect(proof.refusal).toBe("recordingTooOld");
  });

  test("SHADOW-O19: the stale run catalogs no deletion where a faithful port would", () => {
    const stale = cataloged(runShadow(staleInput(), shadowOptions()));

    expect(stale.deletions).toEqual([]);
  });

  test("SHADOW-O19: the same row inside the bound does catalogue the deletion", () => {
    const fresh = cataloged(
      runShadow(staleInput(), shadowOptions({ maxCoverageAgeSeconds: 60 * 60 * 24 * 365 })),
    );

    expect(fresh.deletions.length).toBe(1);
  });

  test("SHADOW-O19: the under-report is named on the catalog rather than left implicit", () => {
    const stale = cataloged(runShadow(staleInput(), shadowOptions()));

    expect(stale.caveats).toContain("coverageStalerThanTheLiveEngineAccepts");
    expect(stale.coverage.map((verdict) => verdict.refusal)).toContain("recordingTooOld");
  });
});
