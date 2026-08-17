import { describe, expect, test } from "vitest";
import { translateDestinationSync } from "../../src/index";
import { cataloged, firstOf, runShadow } from "../support/scenario";
import { instant } from "../support/handles";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedCoverage,
  storedSourceEvent,
  syncInput,
  timedAt,
} from "../support/fixtures";

const inTheGap = slotIdentity(
  "evt-gap",
  "2026-09-10T09:00:00.000Z",
  "2026-09-10T10:00:00.000Z",
);

const gapTime = timedAt("2026-09-10T09:00:00.000Z", "2026-09-10T10:00:00.000Z");

const requestedWindow = {
  start: instant("2026-01-01T00:00:00.000Z"),
  end: instant("2026-12-31T00:00:00.000Z"),
};

const narrowCoverage = () =>
  storedCoverage({
    ingestWindowStart: "2026-01-01T00:00:00.000Z",
    ingestWindowEnd: "2026-04-01T00:00:00.000Z",
    historicRange: {
      start: instant("2026-01-01T00:00:00.000Z"),
      end: instant("2026-03-01T00:00:00.000Z"),
    },
    futureRange: {
      start: instant("2026-03-01T00:00:00.000Z"),
      end: instant("2026-04-01T00:00:00.000Z"),
    },
  });

const mirrorBetweenCoverageAndTheEdge = () =>
  syncInput({
    mirrorWindow: requestedWindow,
    storedSourceEvents: [storedSourceEvent({ identity: inTheGap, time: gapTime })],
    mirrors: [
      mirrorRow({
        identity: inTheGap,
        time: gapTime,
        destinationId: "mirror-evt-gap",
        destinationHandle: "handle-evt-gap",
      }),
    ],
    destinationListing: destinationSnapshot({
      events: [
        ownMirrorEvent({
          id: "mirror-evt-gap",
          uid: "evt-gap",
          deleteHandle: "handle-evt-gap",
          time: gapTime,
        }),
      ],
    }),
    storedCoverage: [narrowCoverage()],
  });

describe("the mirror window cannot manufacture a retirement", () => {
  test("SHADOW-O6: a mapping between recorded coverage and the requested edge is not catalogued as a deletion", () => {
    const catalog = cataloged(runShadow(mirrorBetweenCoverageAndTheEdge(), shadowOptions()));

    expect(catalog.deletions).toEqual([]);
  });

  test("SHADOW-O6: no deletion is ever tagged outsideMirrorWindow from a synthesized listing", () => {
    const catalog = cataloged(runShadow(mirrorBetweenCoverageAndTheEdge(), shadowOptions()));

    expect(catalog.deletions.map((entry) => entry.cause)).not.toContain("outsideMirrorWindow");
  });

  test("SHADOW-O6: the scope window equals the policy mirror window, so the path is unreachable", () => {
    const translation = translateDestinationSync(
      mirrorBetweenCoverageAndTheEdge(),
      shadowOptions(),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const unit = firstOf(translation.units);

    expect(unit.observed.source.scope.window).toEqual(unit.policy.mirrorWindow);
    expect(unit.observed.source.scope.window.end.value).toBe(requestedWindow.end.value);
  });
});
