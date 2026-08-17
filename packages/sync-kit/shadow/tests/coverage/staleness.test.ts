import { describe, expect, test } from "vitest";
import { sourceCoverageFrom } from "../../src/index";
import { asOf, mirrorWindow, storedCoverage } from "../support/fixtures";

const proofRecordedAt = (recordedAt: string, maxCoverageAgeSeconds: number) =>
  sourceCoverageFrom({
    stored: storedCoverage({ recordedAt }),
    mirrorWindow,
    asOf,
    maxCoverageAgeSeconds,
  });

describe("stored coverage has an age", () => {
  test("SHADOW-I6: a recording older than the bound is unproven", () => {
    const proof = proofRecordedAt("2026-05-01T00:00:00.000Z", 86_400);

    expect(proof.kind).toBe("unproven");
    if (proof.kind !== "unproven") {
      throw new Error("expected an unproven proof");
    }
    expect(proof.refusal).toBe("recordingTooOld");
  });

  test("SHADOW-I6: the bound that stopped it is the configured one, not an incidental one", () => {
    const strict = proofRecordedAt("2026-06-15T11:30:00.000Z", 60);
    const generous = proofRecordedAt("2026-06-15T11:30:00.000Z", 86_400);

    expect(strict.kind).toBe("unproven");
    expect(generous.kind).toBe("proven");
  });

  test("SHADOW-I6: a recording exactly at the bound is still proof", () => {
    const proof = proofRecordedAt("2026-06-15T11:30:00.000Z", 1800);

    expect(proof.kind).toBe("proven");
    if (proof.kind !== "proven") {
      throw new Error("expected a proven proof");
    }
    expect(proof.ageSeconds).toBe(1800);
  });

  test("SHADOW-I6: a recording later than asOf is refused", () => {
    const proof = proofRecordedAt("2026-06-15T13:00:00.000Z", 86_400);

    expect(proof.kind).toBe("unproven");
    if (proof.kind !== "unproven") {
      throw new Error("expected an unproven proof");
    }
    expect(proof.refusal).toBe("recordedInTheFuture");
  });

  test("SHADOW-I6: a proven proof reports the age it was judged on", () => {
    const proof = proofRecordedAt("2026-06-15T11:00:00.000Z", 86_400);
    if (proof.kind !== "proven") {
      throw new Error("expected a proven proof");
    }

    expect(proof.ageSeconds).toBe(3600);
    expect(proof.recordedAt.value).toBe("2026-06-15T11:00:00.000Z");
  });
});
