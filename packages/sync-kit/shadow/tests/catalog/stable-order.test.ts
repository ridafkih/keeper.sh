import { describe, expect, test } from "vitest";
import type { SourceIdentity } from "@keeper.sh/sync-reconcile";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { cataloged, runShadow } from "../support/scenario";
import { planWith, retireTombstone } from "../support/plans";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const five = ["evt-e", "evt-a", "evt-c", "evt-b", "evt-d"].map((key) =>
  slotIdentity(key, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const inputFor = (order: readonly SourceIdentity[]) =>
  syncInput({
    storedSourceEvents: order.map((identity) => storedSourceEvent({ identity })),
    mirrors: order.map((identity) =>
      mirrorRow({
        identity,
        destinationId: `mirror-${identity.uid.value}`,
        destinationHandle: `handle-${identity.uid.value}`,
      }),
    ),
    destinationListing: destinationSnapshot({
      events: order.map((identity) =>
        ownMirrorEvent({
          id: `mirror-${identity.uid.value}`,
          uid: identity.uid.value,
          deleteHandle: `handle-${identity.uid.value}`,
        }),
      ),
    }),
  });

const planFor = (order: readonly SourceIdentity[]) => () =>
  planWith({
    tombstones: order.map((identity) => retireTombstone(identity, "absentFromSnapshot")),
  });

const catalogJsonFor = (order: readonly SourceIdentity[]): string =>
  JSON.stringify(cataloged(runShadow(inputFor(order), shadowOptions({ plan: planFor(order) }))));

const permutationsOf = <Item>(items: readonly Item[]): readonly (readonly Item[])[] => {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    return permutationsOf(rest).map((tail) => [item, ...tail]);
  });
};

describe("the catalog is stable", () => {
  test("SHADOW-I28: identical inputs produce a byte-identical catalog", () => {
    expect(catalogJsonFor(five)).toBe(catalogJsonFor(five));
  });

  test("SHADOW-I28: all permutations of a five-event input produce the same catalog", () => {
    const permutations = permutationsOf(five);
    const expected = catalogJsonFor(five);

    expect(permutations.length).toBe(120);
    for (const order of permutations) {
      expect(catalogJsonFor(order)).toBe(expected);
    }
  });

  test("SHADOW-I28: the catalog is independent of the ambient time zone", () => {
    const underUtc = JSON.stringify(
      renderCatalog(
        cataloged(runShadow(inputFor(five), shadowOptions({ plan: planFor(five) }))),
        defaultShadowLimits,
      ),
    );
    const ambient = process.env["TZ"];
    process.env["TZ"] = "Pacific/Kiritimati";
    try {
      expect(
        JSON.stringify(
          renderCatalog(
            cataloged(runShadow(inputFor(five), shadowOptions({ plan: planFor(five) }))),
            defaultShadowLimits,
          ),
        ),
      ).toBe(underUtc);
    } finally {
      process.env["TZ"] = ambient;
    }
  });

  test("SHADOW-I28: every deletion carries the signature it was ordered by", () => {
    const catalog = cataloged(runShadow(inputFor(five), shadowOptions({ plan: planFor(five) })));
    const signatures = catalog.deletions.map((entry) => entry.signature);

    expect(signatures).toEqual([...signatures].toSorted());
    expect(new Set(signatures).size).toBe(signatures.length);
  });
});
