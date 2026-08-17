import { describe, expect, test } from "vitest";
import { sourceIdentityKey } from "@keeper.sh/sync-reconcile";
import { translateDestinationSync } from "../../src/index";
import { instant } from "../support/handles";
import { firstOf } from "../support/scenario";
import {
  mirrorRow,
  shadowOptions,
  slotIdentity,
  storedCoverage,
  storedSourceEvent,
  syncInput,
  timedAt,
} from "../support/fixtures";

const insideCoverage = slotIdentity(
  "evt-inside",
  "2026-02-10T09:00:00.000Z",
  "2026-02-10T10:00:00.000Z",
);

const inTheBand = slotIdentity(
  "evt-band",
  "2026-09-10T09:00:00.000Z",
  "2026-09-10T10:00:00.000Z",
);

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

const translatedUnit = () => {
  const translation = translateDestinationSync(
    syncInput({
      storedSourceEvents: [
        storedSourceEvent({ identity: insideCoverage, time: timedAt("2026-02-10T09:00:00.000Z", "2026-02-10T10:00:00.000Z") }),
        storedSourceEvent({ identity: inTheBand, time: timedAt("2026-09-10T09:00:00.000Z", "2026-09-10T10:00:00.000Z") }),
      ],
      mirrors: [
        mirrorRow({ identity: insideCoverage }),
        mirrorRow({
          identity: inTheBand,
          destinationId: "mirror-band",
          destinationHandle: "handle-band-legacy",
        }),
      ],
      storedCoverage: [narrowCoverage()],
    }),
    shadowOptions(),
  );
  if (translation.kind !== "translated") {
    throw new Error(`expected a translation, got ${translation.reason}`);
  }
  return firstOf(translation.units);
};

describe("mappings are forwarded whole", () => {
  test("SHADOW-I11: a mapping outside proven coverage is still in the mapping set", () => {
    const keys = translatedUnit().mappings.entries.map((entry) =>
      sourceIdentityKey(entry.sourceIdentity),
    );

    expect(keys).toContain(sourceIdentityKey(inTheBand));
    expect(keys).toContain(sourceIdentityKey(insideCoverage));
    expect(keys.length).toBe(2);
  });

  test("SHADOW-I16: the stored delete identifier is carried through untouched", () => {
    const band = translatedUnit().mappings.entries.find(
      (entry) => sourceIdentityKey(entry.sourceIdentity) === sourceIdentityKey(inTheBand),
    );
    if (!band) {
      throw new Error("expected the band mapping to survive");
    }

    expect(band.destination.deleteHandle.value).toBe("handle-band-legacy");
    expect(band.destination.id.value).toBe("mirror-band");
    expect(band.destination.deleteHandle.value).not.toBe(band.sourceIdentity.uid.value);
  });
});
