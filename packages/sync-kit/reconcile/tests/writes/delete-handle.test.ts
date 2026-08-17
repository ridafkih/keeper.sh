import { describe, expect, test } from "vitest";
import { firstOf } from "../support/at";
import { planReconciliation } from "../../src/index";
import {
  bothSides,
  destinationCalendar,
  destinationScope,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  ourInstallation,
  ownedEvent,
  policy,
  slotIdentity,
  snapshotListing,
  sourceOnly,
} from "../support/fixtures";

const identity = slotIdentity("evt-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const mappingWithLegacyHandle = () =>
  mapping({ identity, destinationId: "mirror-1", destinationHandle: "legacy-ical-uid" });

const mirrorWithCurrentHandle = () =>
  ownedEvent(
    {
      id: "mirror-1",
      uid: "mirror-1",
      deleteHandle: "current-provider-id",
      calendar: destinationCalendar,
    },
    ourInstallation,
  );

describe("retire the identifier this listing gave you", () => {
  test("RECON-O17: an observed mirror's own delete handle beats the mapping's stored one", () => {
    const plan = planReconciliation(
      bothSides(
        snapshotListing({ events: [] }),
        snapshotListing({ events: [mirrorWithCurrentHandle()], scope: destinationScope }),
      ),
      knownState([knownEvent({ identity })]),
      mappingSet([mappingWithLegacyHandle()]),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(1);
    expect(firstOf(plan.tombstones).handle?.value).toBe("current-provider-id");
  });

  test("RECON-O17: with no destination listing the stored handle is the only one available", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [] })),
      knownState([knownEvent({ identity })]),
      mappingSet([mappingWithLegacyHandle()]),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(1);
    expect(firstOf(plan.tombstones).handle?.value).toBe("legacy-ical-uid");
  });

  test("RECON-O17: an unmapped absence forgets the row rather than inventing a delete", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [] })),
      knownState([knownEvent({ identity })]),
      mappingSet([]),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(1);
    expect(firstOf(plan.tombstones).kind).toBe("forgetKnownRow");
    expect(firstOf(plan.tombstones).handle).toBeUndefined();
  });

  test("RECON-O17: a mapped retirement carries the mapping's precondition", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [] })),
      knownState([knownEvent({ identity })]),
      mappingSet([mappingWithLegacyHandle()]),
      policy(),
    );

    expect(firstOf(plan.tombstones).kind).toBe("retireMirror");
    expect(firstOf(plan.tombstones).precondition).toEqual({
      kind: "matchesVersion",
      version: { kind: "remoteVersion", value: "v-mirror-1-1" },
    });
  });
});
