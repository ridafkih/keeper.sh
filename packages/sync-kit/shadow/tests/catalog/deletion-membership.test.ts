import { describe, expect, test } from "vitest";
import { cataloged, firstOf, runShadow } from "../support/scenario";
import { forgetTombstone, planWith, replaceWrite, retireTombstone } from "../support/plans";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const retired = slotIdentity("evt-retired", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const forgotten = slotIdentity(
  "evt-forgotten",
  "2026-03-11T09:00:00.000Z",
  "2026-03-11T10:00:00.000Z",
);
const replaced = slotIdentity(
  "evt-replaced",
  "2026-03-12T09:00:00.000Z",
  "2026-03-12T10:00:00.000Z",
);

const identities = [retired, forgotten, replaced];

const mixedInput = () =>
  syncInput({
    storedSourceEvents: identities.map((identity) => storedSourceEvent({ identity })),
    mirrors: identities.map((identity) =>
      mirrorRow({
        identity,
        destinationId: `mirror-${identity.uid.value}`,
        destinationHandle: `handle-${identity.uid.value}`,
      }),
    ),
    destinationListing: destinationSnapshot({
      events: identities.map((identity) =>
        ownMirrorEvent({
          id: `mirror-${identity.uid.value}`,
          uid: identity.uid.value,
          deleteHandle: `handle-${identity.uid.value}`,
        }),
      ),
    }),
  });

const mixedCatalog = () =>
  cataloged(
    runShadow(
      mixedInput(),
      shadowOptions({
        plan: () =>
          planWith({
            writes: [replaceWrite(replaced)],
            tombstones: [
              retireTombstone(retired, "absentFromSnapshot"),
              forgetTombstone(forgotten, "absentFromSnapshot"),
            ],
          }),
      }),
    ),
  );

describe("what counts as a deletion", () => {
  test("SHADOW-I12: a forgetKnownRow tombstone is not a deletion", () => {
    const catalog = mixedCatalog();

    expect(catalog.deletions.map((entry) => entry.uid.value)).not.toContain("evt-forgotten");
    expect(catalog.forgottenLocalRows.map((entry) => entry.uid.value)).toEqual(["evt-forgotten"]);
  });

  test("SHADOW-I12: a replace's retire leg is a deletion", () => {
    const replacedDeletions = mixedCatalog().deletions.filter(
      (entry) => entry.uid.value === "evt-replaced",
    );

    expect(replacedDeletions.length).toBe(1);
    expect(firstOf(replacedDeletions).origin).toBe("replaceRetire");
    expect(firstOf(replacedDeletions).deleteHandle.value).toBe("handle-evt-replaced");
  });

  test("SHADOW-I12: a retireMirror tombstone is a deletion tagged tombstone", () => {
    const catalog = mixedCatalog();
    const retiredDeletions = catalog.deletions.filter((entry) => entry.uid.value === "evt-retired");

    expect(retiredDeletions.length).toBe(1);
    expect(firstOf(retiredDeletions).origin).toBe("tombstone");
    expect(catalog.deletions.length).toBe(2);
  });

  test("SHADOW-I12: every deletion carries a handle and a precondition kind", () => {
    for (const entry of mixedCatalog().deletions) {
      expect(entry.deleteHandle.value.length).toBeGreaterThan(0);
      expect(["matchesVersion", "matchesFingerprint"]).toContain(entry.preconditionKind);
    }
  });

  test("SHADOW-I12: a forgotten row carries no delete handle at all", () => {
    const forgottenRows = mixedCatalog().forgottenLocalRows;

    expect(firstOf(forgottenRows).cause).toBe("absentFromSnapshot");
    expect(Reflect.get(firstOf(forgottenRows), "deleteHandle")).toBeUndefined();
  });
});
