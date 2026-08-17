import { describe, expect, test } from "vitest";
import { sourceCoverageFrom, translateDestinationSync } from "../../src/index";
import { instant } from "../support/handles";
import { firstOf } from "../support/scenario";
import {
  asOf,
  mirrorRow,
  shadowOptions,
  slotIdentity,
  storedCoverage,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const recordedWindow = {
  start: instant("2026-02-01T00:00:00.000Z"),
  end: instant("2026-04-01T00:00:00.000Z"),
};

const requestedMirrorWindow = {
  start: instant("2026-01-01T00:00:00.000Z"),
  end: instant("2026-12-31T00:00:00.000Z"),
};

const narrowCoverage = () =>
  storedCoverage({
    ingestWindowStart: recordedWindow.start.value,
    ingestWindowEnd: recordedWindow.end.value,
    historicRange: { start: recordedWindow.start, end: instant("2026-03-01T00:00:00.000Z") },
    futureRange: { start: instant("2026-03-01T00:00:00.000Z"), end: recordedWindow.end },
  });

describe("storage bounds and mirror bounds are different windows", () => {
  test("SHADOW-I26: the stored read's extent is never used as coverage", () => {
    const identityFar = slotIdentity(
      "evt-far",
      "2026-11-10T09:00:00.000Z",
      "2026-11-10T10:00:00.000Z",
    );
    const translation = translateDestinationSync(
      syncInput({
        mirrorWindow: requestedMirrorWindow,
        storedSourceEvents: [storedSourceEvent({ identity: identityFar })],
        mirrors: [mirrorRow({ identity: identityFar })],
        storedCoverage: [narrowCoverage()],
      }),
      shadowOptions(),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const unit = firstOf(translation.units);
    if (unit.proof.kind !== "proven") {
      throw new Error(`expected a proven proof, got ${unit.proof.refusal}`);
    }

    expect(unit.proof.coverage.future.end.value).toBe(recordedWindow.end.value);
    expect(unit.proof.coverage.future.end.value).not.toBe("2026-11-10T10:00:00.000Z");
  });

  test("SHADOW-I26: the mirror window and the coverage window are separate inputs", () => {
    const proof = sourceCoverageFrom({
      stored: narrowCoverage(),
      mirrorWindow: requestedMirrorWindow,
      asOf,
      maxCoverageAgeSeconds: 86_400,
    });
    if (proof.kind !== "proven") {
      throw new Error(`expected a proven proof, got ${proof.refusal}`);
    }

    expect(proof.coverage.historic.start.value).toBe(recordedWindow.start.value);
    expect(proof.coverage.future.end.value).toBe(recordedWindow.end.value);
    expect(proof.coverage.historic.start.value).not.toBe(requestedMirrorWindow.start.value);
    expect(proof.coverage.future.end.value).not.toBe(requestedMirrorWindow.end.value);
  });
});
