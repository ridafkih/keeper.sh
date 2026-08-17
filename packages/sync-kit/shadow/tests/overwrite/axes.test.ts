import { describe, expect, test } from "vitest";
import { cataloged, runShadow } from "../support/scenario";
import { instant } from "../support/handles";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedCoverage,
  syncInput,
  timedAt,
} from "../support/fixtures";

const historicOrphan = slotIdentity(
  "evt-historic",
  "2026-02-10T09:00:00.000Z",
  "2026-02-10T10:00:00.000Z",
);

const futureOrphan = slotIdentity(
  "evt-future",
  "2026-09-10T09:00:00.000Z",
  "2026-09-10T10:00:00.000Z",
);

const futureOnlyCoverage = () =>
  storedCoverage({
    ingestWindowStart: "2026-08-01T00:00:00.000Z",
    ingestWindowEnd: "2026-12-31T00:00:00.000Z",
    historicRange: {
      start: instant("2026-08-01T00:00:00.000Z"),
      end: instant("2026-08-01T00:00:00.000Z"),
    },
    futureRange: {
      start: instant("2026-08-01T00:00:00.000Z"),
      end: instant("2026-12-31T00:00:00.000Z"),
    },
  });

const oneOnEachAxis = () =>
  syncInput({
    storedSourceEvents: [],
    mirrors: [
      mirrorRow({
        identity: historicOrphan,
        time: timedAt("2026-02-10T09:00:00.000Z", "2026-02-10T10:00:00.000Z"),
        destinationId: "mirror-evt-historic",
        destinationHandle: "handle-evt-historic",
      }),
      mirrorRow({
        identity: futureOrphan,
        time: timedAt("2026-09-10T09:00:00.000Z", "2026-09-10T10:00:00.000Z"),
        destinationId: "mirror-evt-future",
        destinationHandle: "handle-evt-future",
      }),
    ],
    destinationListing: destinationSnapshot({
      events: [
        ownMirrorEvent({
          id: "mirror-evt-historic",
          uid: "evt-historic",
          deleteHandle: "handle-evt-historic",
          time: timedAt("2026-02-10T09:00:00.000Z", "2026-02-10T10:00:00.000Z"),
        }),
        ownMirrorEvent({
          id: "mirror-evt-future",
          uid: "evt-future",
          deleteHandle: "handle-evt-future",
          time: timedAt("2026-09-10T09:00:00.000Z", "2026-09-10T10:00:00.000Z"),
        }),
      ],
    }),
    storedCoverage: [futureOnlyCoverage()],
  });

describe("a wide future axis does not license a historic deletion", () => {
  test("SHADOW-O3: a proven future axis does not license a historic deletion", () => {
    const catalog = cataloged(runShadow(oneOnEachAxis(), shadowOptions()));
    const deleted = catalog.deletions.map((entry) => entry.uid.value);

    expect(deleted).toContain("evt-future");
    expect(deleted).not.toContain("evt-historic");
    expect(catalog.deletions.length).toBe(1);
  });

  test("SHADOW-O3: the historic orphan is reported as outside proven coverage, not silently dropped", () => {
    const catalog = cataloged(runShadow(oneOnEachAxis(), shadowOptions()));
    const reasons = catalog.unresolved.map((entry) => entry.reason);

    expect(reasons).toContain("outsideProvenCoverage");
  });
});
