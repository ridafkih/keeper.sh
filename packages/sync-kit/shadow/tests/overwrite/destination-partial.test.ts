import { describe, expect, test } from "vitest";
import { cataloged, runShadow } from "../support/scenario";
import {
  destinationPartial,
  mirrorRow,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const mapped = ["evt-1", "evt-2", "evt-3"].map((key) =>
  slotIdentity(key, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const truncatedDestinationRead = () =>
  syncInput({
    storedSourceEvents: mapped.map((identity) => storedSourceEvent({ identity })),
    mirrors: mapped.map((identity) =>
      mirrorRow({
        identity,
        destinationId: `mirror-${identity.uid.value}`,
        destinationHandle: `handle-${identity.uid.value}`,
      }),
    ),
    destinationListing: destinationPartial({ events: [] }),
  });

describe("a truncated destination read is not an empty destination", () => {
  test("SHADOW-O10: a partial destination listing catalogs no deletion and no overwrite", () => {
    const catalog = cataloged(runShadow(truncatedDestinationRead(), shadowOptions()));

    expect(catalog.deletions).toEqual([]);
    expect(catalog.updates).toEqual([]);
    expect(catalog.replacements).toEqual([]);
  });

  test("SHADOW-O10: the run still reports itself as cataloged rather than silently empty", () => {
    const catalog = runShadow(truncatedDestinationRead(), shadowOptions());

    expect(catalog.kind).toBe("cataloged");
  });
});
