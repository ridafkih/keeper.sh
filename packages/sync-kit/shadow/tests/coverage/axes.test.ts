import { describe, expect, test } from "vitest";
import { sourceCoverageFrom } from "../../src/index";
import { instant } from "../support/handles";
import { asOf, storedCoverage } from "../support/fixtures";

const narrowMirrorWindow = {
  start: instant("2026-01-01T00:00:00.000Z"),
  end: instant("2026-12-31T00:00:00.000Z"),
};

describe("coverage is two axes, not one span", () => {
  test("SHADOW-I4: the two axes are intersected independently", () => {
    const proof = sourceCoverageFrom({
      stored: storedCoverage({
        ingestWindowStart: "2025-06-01T00:00:00.000Z",
        ingestWindowEnd: "2027-06-01T00:00:00.000Z",
        historicRange: {
          start: instant("2025-06-01T00:00:00.000Z"),
          end: instant("2026-02-01T00:00:00.000Z"),
        },
        futureRange: {
          start: instant("2026-02-01T00:00:00.000Z"),
          end: instant("2027-06-01T00:00:00.000Z"),
        },
      }),
      mirrorWindow: narrowMirrorWindow,
      asOf,
      maxCoverageAgeSeconds: 86_400,
    });
    if (proof.kind !== "proven") {
      throw new Error(`expected a proven proof, got ${proof.refusal}`);
    }

    expect(proof.coverage.historic.start.value).toBe("2026-01-01T00:00:00.000Z");
    expect(proof.coverage.historic.end.value).toBe("2026-02-01T00:00:00.000Z");
    expect(proof.coverage.future.start.value).toBe("2026-02-01T00:00:00.000Z");
    expect(proof.coverage.future.end.value).toBe("2026-12-31T00:00:00.000Z");
  });

  test("SHADOW-I4: the gap between the axes is never claimed as covered", () => {
    const proof = sourceCoverageFrom({
      stored: storedCoverage({
        historicRange: {
          start: instant("2026-01-01T00:00:00.000Z"),
          end: instant("2026-02-01T00:00:00.000Z"),
        },
        futureRange: {
          start: instant("2026-11-01T00:00:00.000Z"),
          end: instant("2026-12-31T00:00:00.000Z"),
        },
      }),
      mirrorWindow: narrowMirrorWindow,
      asOf,
      maxCoverageAgeSeconds: 86_400,
    });
    if (proof.kind !== "unproven") {
      throw new Error("expected two disjoint axes to refuse rather than span the gap");
    }

    expect(proof.refusal).toBe("nonContiguousCoverageAxes");
  });

  test("SHADOW-I4: an axis outside the recorded ingest window proves nothing", () => {
    const proof = sourceCoverageFrom({
      stored: storedCoverage({
        ingestWindowStart: "2026-06-01T00:00:00.000Z",
        ingestWindowEnd: "2026-06-02T00:00:00.000Z",
        historicRange: {
          start: instant("2000-01-01T00:00:00.000Z"),
          end: instant("2026-06-01T00:00:00.000Z"),
        },
        futureRange: {
          start: instant("2026-06-01T00:00:00.000Z"),
          end: instant("2400-01-01T00:00:00.000Z"),
        },
      }),
      mirrorWindow: narrowMirrorWindow,
      asOf,
      maxCoverageAgeSeconds: 86_400,
    });
    if (proof.kind !== "proven") {
      throw new Error(`expected a proven proof, got ${proof.refusal}`);
    }

    expect(proof.covered.start.value).toBe("2026-06-01T00:00:00.000Z");
    expect(proof.covered.end.value).toBe("2026-06-02T00:00:00.000Z");
  });

  test("SHADOW-I4: one axis proven and the other empty still names both axes", () => {
    const proof = sourceCoverageFrom({
      stored: storedCoverage({
        historicRange: {
          start: instant("2020-01-01T00:00:00.000Z"),
          end: instant("2020-02-01T00:00:00.000Z"),
        },
        futureRange: {
          start: instant("2026-11-01T00:00:00.000Z"),
          end: instant("2026-12-31T00:00:00.000Z"),
        },
      }),
      mirrorWindow: narrowMirrorWindow,
      asOf,
      maxCoverageAgeSeconds: 86_400,
    });
    if (proof.kind !== "proven") {
      throw new Error(`expected a proven proof, got ${proof.refusal}`);
    }

    expect(proof.coverage.historic.start.value).toBe(proof.coverage.historic.end.value);
    expect(proof.coverage.future.start.value).toBe("2026-11-01T00:00:00.000Z");
    expect(proof.covered).toEqual(proof.coverage.future);
  });
});
