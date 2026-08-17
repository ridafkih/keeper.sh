import { describe, expect, test } from "vitest";
import { sourceCoverageFrom } from "../../src/index";
import type { SourceCoverageProof } from "../../src/index";
import { instant } from "../support/handles";
import { asOf, mirrorWindow, storedCoverage } from "../support/fixtures";

const proofFor = (stored: Parameters<typeof sourceCoverageFrom>[0]["stored"]): SourceCoverageProof =>
  sourceCoverageFrom({ stored, mirrorWindow, asOf, maxCoverageAgeSeconds: 86_400 });

describe("coverage comes from what was recorded", () => {
  test("SHADOW-I3: a missing ingest window yields unproven, not the requested window", () => {
    const proof = proofFor(storedCoverage({ ingestWindowStart: null }));

    expect(proof.kind).toBe("unproven");
    if (proof.kind !== "unproven") {
      throw new Error("expected an unproven proof");
    }
    expect(proof.refusal).toBe("noRecordedIngestWindow");
    expect(JSON.stringify(proof)).not.toContain(mirrorWindow.end.value);
  });

  test("SHADOW-I3: a missing recording timestamp yields unproven", () => {
    const proof = proofFor(storedCoverage({ recordedAt: null }));

    expect(proof.kind).toBe("unproven");
  });

  test("SHADOW-I3: missing axes yield unproven rather than a bounding span", () => {
    const proof = proofFor(storedCoverage({ historicRange: null, futureRange: null }));

    expect(proof.kind).toBe("unproven");
    if (proof.kind !== "unproven") {
      throw new Error("expected an unproven proof");
    }
    expect(proof.refusal).toBe("noRecordedAxes");
  });

  test("SHADOW-I3: an ingest window recorded end-before-start is refused", () => {
    const proof = proofFor(
      storedCoverage({
        ingestWindowStart: "2026-09-01T00:00:00.000Z",
        ingestWindowEnd: "2026-02-01T00:00:00.000Z",
      }),
    );

    expect(proof.kind).toBe("unproven");
    if (proof.kind !== "unproven") {
      throw new Error("expected an unproven proof");
    }
    expect(proof.refusal).toBe("unorderedIngestWindow");
  });

  test("SHADOW-I3: the requested window never widens the recorded one", () => {
    const proof = proofFor(
      storedCoverage({
        ingestWindowStart: "2026-04-01T00:00:00.000Z",
        ingestWindowEnd: "2026-08-01T00:00:00.000Z",
        historicRange: {
          start: instant("2026-04-01T00:00:00.000Z"),
          end: instant("2026-06-01T00:00:00.000Z"),
        },
        futureRange: {
          start: instant("2026-06-01T00:00:00.000Z"),
          end: instant("2026-08-01T00:00:00.000Z"),
        },
      }),
    );
    if (proof.kind !== "proven") {
      throw new Error(`expected a proven proof, got ${proof.refusal}`);
    }

    expect(proof.coverage.historic.start.value).toBe("2026-04-01T00:00:00.000Z");
    expect(proof.coverage.future.end.value).toBe("2026-08-01T00:00:00.000Z");
    expect(proof.coverage.historic.start.value).not.toBe(mirrorWindow.start.value);
    expect(proof.coverage.future.end.value).not.toBe(mirrorWindow.end.value);
  });

  test("SHADOW-I3: an axis wider than the recorded ingest window is clamped to it", () => {
    const proof = proofFor(
      storedCoverage({
        ingestWindowStart: "2026-06-01T00:00:00.000Z",
        ingestWindowEnd: "2026-06-02T00:00:00.000Z",
        historicRange: {
          start: instant("2000-01-01T00:00:00.000Z"),
          end: instant("2026-06-01T12:00:00.000Z"),
        },
        futureRange: {
          start: instant("2026-06-01T12:00:00.000Z"),
          end: instant("2400-01-01T00:00:00.000Z"),
        },
      }),
    );
    if (proof.kind !== "proven") {
      throw new Error(`expected a proven proof, got ${proof.refusal}`);
    }

    expect(proof.coverage.historic.start.value).toBe("2026-06-01T00:00:00.000Z");
    expect(proof.coverage.future.end.value).toBe("2026-06-02T00:00:00.000Z");
    expect(proof.covered.start.value).toBe("2026-06-01T00:00:00.000Z");
    expect(proof.covered.end.value).toBe("2026-06-02T00:00:00.000Z");
  });

  test("SHADOW-I3: a recorded window disjoint from the mirror window proves nothing", () => {
    const proof = proofFor(
      storedCoverage({
        ingestWindowStart: "2020-01-01T00:00:00.000Z",
        ingestWindowEnd: "2020-06-01T00:00:00.000Z",
        historicRange: {
          start: instant("2020-01-01T00:00:00.000Z"),
          end: instant("2020-03-01T00:00:00.000Z"),
        },
        futureRange: {
          start: instant("2020-03-01T00:00:00.000Z"),
          end: instant("2020-06-01T00:00:00.000Z"),
        },
      }),
    );

    expect(proof.kind).toBe("unproven");
    if (proof.kind !== "unproven") {
      throw new Error("expected an unproven proof");
    }
    expect(proof.refusal).toBe("emptyIntersectionWithMirrorWindow");
  });
});
