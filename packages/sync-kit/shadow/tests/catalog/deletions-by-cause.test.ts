import { describe, expect, test } from "vitest";
import { tombstoneCauses } from "@keeper.sh/sync-reconcile";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { catalogOfPlan, cataloged } from "../support/scenario";
import { planWith, retireTombstone } from "../support/plans";
import { slotIdentity } from "../support/fixtures";

const identityFor = (cause: string) =>
  slotIdentity(`evt-${cause}`, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const everyCauseIdentities = tombstoneCauses.map((cause) => identityFor(cause));

const everyCausePlan = () =>
  planWith({
    tombstones: tombstoneCauses.map((cause, index) => {
      const identity = everyCauseIdentities.at(index);
      if (!identity) {
        throw new Error(`no identity for ${cause}`);
      }
      return retireTombstone(identity, cause);
    }),
  });

describe("deletions are broken out by cause", () => {
  test("SHADOW-I14: every tombstone cause gets its own counter", () => {
    const catalog = cataloged(catalogOfPlan(everyCauseIdentities, everyCausePlan()));
    const rendered = renderCatalog(catalog, defaultShadowLimits);

    for (const cause of tombstoneCauses) {
      expect(rendered[`shadow.deletions.cause.${cause}`]).toBe(1);
    }
    expect(rendered["shadow.deletions.total"]).toBe(tombstoneCauses.length);
  });

  test("SHADOW-I14: a cause with no deletions still renders a zero", () => {
    const only = everyCauseIdentities.slice(0, 1);
    const identity = only.at(0);
    if (!identity) {
      throw new Error("expected one identity");
    }
    const catalog = cataloged(
      catalogOfPlan(only, planWith({ tombstones: [retireTombstone(identity, "explicitRemoval")] })),
    );
    const rendered = renderCatalog(catalog, defaultShadowLimits);

    expect(rendered["shadow.deletions.cause.explicitRemoval"]).toBe(1);
    expect(rendered["shadow.deletions.cause.absentFromSnapshot"]).toBe(0);
    expect(rendered["shadow.deletions.cause.outsideMirrorWindow"]).toBe(0);
    expect(rendered["shadow.deletions.cause.destinationDisconnected"]).toBe(0);
  });

  test("SHADOW-I14: each catalogued deletion carries the cause it was rendered under", () => {
    const catalog = cataloged(catalogOfPlan(everyCauseIdentities, everyCausePlan()));

    expect(catalog.deletions.map((entry) => entry.cause).toSorted()).toEqual(
      [...tombstoneCauses].toSorted(),
    );
  });
});
