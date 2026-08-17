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

const five = ["evt-e", "evt-b", "evt-d", "evt-a", "evt-c"].map((key) =>
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

const renderedFor = (order: readonly SourceIdentity[]): string =>
  JSON.stringify(
    renderCatalog(
      cataloged(runShadow(inputFor(order), shadowOptions({ plan: planFor(order) }))),
      defaultShadowLimits,
    ),
  );

const permutationsOf = <Item>(items: readonly Item[]): readonly (readonly Item[])[] => {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    return permutationsOf(rest).map((tail) => [item, ...tail]);
  });
};

describe("two days of catalogs must be diffable", () => {
  test("SHADOW-O22: two runs of the same input render byte-for-byte identically", () => {
    expect(renderedFor(five)).toBe(renderedFor(five));
  });

  test("SHADOW-O22: all 120 permutations of a five-event input render identically", () => {
    const permutations = permutationsOf(five);
    const expected = renderedFor(five);

    expect(permutations.length).toBe(120);
    for (const order of permutations) {
      expect(renderedFor(order)).toBe(expected);
    }
  });

  test("SHADOW-O22: an added deletion is visible as a difference, so the comparison means something", () => {
    const sixth = slotIdentity("evt-f", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

    expect(renderedFor([...five, sixth])).not.toBe(renderedFor(five));
  });
});
