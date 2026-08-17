import { describe, expect, test } from "vitest";
import { cataloged, runShadow } from "../support/scenario";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const healthy = ["evt-1", "evt-2", "evt-3", "evt-4"].map((key) =>
  slotIdentity(key, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const broken = slotIdentity("evt-bad", "2026-03-11T09:00:00.000Z", "2026-03-11T10:00:00.000Z");
const everyIdentity = [...healthy, broken];

const oneCorruptRow = () =>
  syncInput({
    storedSourceEvents: [
      ...healthy.map((identity) => storedSourceEvent({ identity })),
      storedSourceEvent({ identity: broken, id: "src-bad", canonical: { identity: "garbage" } }),
    ],
    mirrors: everyIdentity.map((identity) =>
      mirrorRow({
        identity,
        sourceRemoteId: identity.uid.value,
        destinationId: `mirror-${identity.uid.value}`,
        destinationHandle: `handle-${identity.uid.value}`,
      }),
    ),
    destinationListing: destinationSnapshot({
      events: everyIdentity.map((identity) =>
        ownMirrorEvent({
          id: `mirror-${identity.uid.value}`,
          uid: identity.uid.value,
          deleteHandle: `handle-${identity.uid.value}`,
        }),
      ),
    }),
  });

describe("a diff against an unreadable baseline computes nothing", () => {
  test("SHADOW-O9: one corrupt row alongside four healthy ones catalogs zero deletions", () => {
    const catalog = cataloged(runShadow(oneCorruptRow(), shadowOptions()));

    expect(catalog.deletions).toEqual([]);
  });

  test("SHADOW-O9: the corrupt row is reported by id rather than being filtered away", () => {
    const catalog = cataloged(runShadow(oneCorruptRow(), shadowOptions()));
    const corrupt = catalog.unresolved.filter((entry) => entry.reason === "corruptKnownState");

    expect(corrupt.length).toBeGreaterThan(0);
    expect(corrupt.map((entry) => entry.id?.value)).toContain("evt-bad");
  });

  test("SHADOW-O9: the four healthy rows are not deleted as collateral either", () => {
    const catalog = cataloged(runShadow(oneCorruptRow(), shadowOptions()));

    for (const identity of healthy) {
      expect(catalog.deletions.map((entry) => entry.uid.value)).not.toContain(identity.uid.value);
    }
  });
});
