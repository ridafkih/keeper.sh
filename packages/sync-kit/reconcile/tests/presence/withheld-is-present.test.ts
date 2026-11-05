import type { WithheldEvent } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { firstOf } from "../support/at";
import { planReconciliation, presenceBasis, writeBasis } from "../../src/index";
import {
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  remoteId,
  slotIdentity,
  snapshotListing,
  sourceOnly,
  uid,
} from "../support/fixtures";

const stalledIdentity = slotIdentity(
  "evt-stalled",
  "2026-03-10T09:00:00.000Z",
  "2026-03-10T10:00:00.000Z",
);

const stalled: WithheldEvent = {
  uid: uid("evt-stalled"),
  id: remoteId("evt-stalled"),
  reason: "recurrenceBudgetExceeded",
};

const listingWithheldOnly = () => snapshotListing({ events: [], withheld: [stalled] });

const known = () => knownState([knownEvent({ identity: stalledIdentity })]);
const mapped = () =>
  mappingSet([mapping({ identity: stalledIdentity, destinationId: "mirror-stalled" })]);

describe("a withheld item is present, it is only unusable", () => {
  test("RECON-O8: ten consecutive polls that withhold the same item plan nothing at all", () => {
    for (let poll = 0; poll < 10; poll++) {
      const plan = planReconciliation(
        sourceOnly(listingWithheldOnly()),
        known(),
        mapped(),
        policy(),
      );

      expect(plan.tombstones).toEqual([]);
      expect(plan.writes).toEqual([]);
    }
  });

  test("RECON-O8: the withheld identity is reported once, as withheldBySource", () => {
    const plan = planReconciliation(sourceOnly(listingWithheldOnly()), known(), mapped(), policy());

    expect(plan.unresolved.map((item) => item.reason)).toEqual(["withheldBySource"]);
  });

  test("RECON-I6: the presence basis counts withheld items, the write basis does not", () => {
    const listing = listingWithheldOnly();

    expect(presenceBasis(listing).withheldKeys.size).toBe(1);
    expect(presenceBasis(listing).presentKeys.size).toBe(1);
    expect(writeBasis(listing)).toEqual([]);
  });

  test("RECON-O28: one withheld item does not suppress a real deletion in the same payload", () => {
    const deletableIdentity = slotIdentity(
      "evt-gone",
      "2026-03-11T09:00:00.000Z",
      "2026-03-11T10:00:00.000Z",
    );

    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [], withheld: [stalled] })),
      knownState([knownEvent({ identity: stalledIdentity }), knownEvent({ identity: deletableIdentity })]),
      mappingSet([
        mapping({ identity: stalledIdentity, destinationId: "mirror-stalled" }),
        mapping({ identity: deletableIdentity, destinationId: "mirror-gone" }),
      ]),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(1);
    expect(firstOf(plan.tombstones).identity.uid.value).toBe("evt-gone");
  });

  test("RECON-O28: an item present as an event and withheld in the same payload is not deleted", () => {
    const plan = planReconciliation(
      sourceOnly(
        snapshotListing({
          events: [foreignEvent({ id: "evt-stalled", uid: "evt-stalled" })],
          withheld: [stalled],
        }),
      ),
      known(),
      mapped(),
      policy(),
    );

    expect(plan.tombstones).toEqual([]);
  });
});
