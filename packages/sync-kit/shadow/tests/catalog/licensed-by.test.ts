import { describe, expect, test } from "vitest";
import { tombstoneCauses } from "@keeper.sh/sync-reconcile";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { catalogOfPlan, cataloged } from "../support/scenario";
import { planWith, provenCoverage, retireTombstone } from "../support/plans";
import { slotIdentity } from "../support/fixtures";

const identities = tombstoneCauses.map((cause) =>
  slotIdentity(`evt-${cause}`, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const planForEveryCause = () =>
  planWith({
    coverage: provenCoverage,
    tombstones: tombstoneCauses.map((cause, index) => {
      const identity = identities.at(index);
      if (!identity) {
        throw new Error(`no identity for ${cause}`);
      }
      return retireTombstone(identity, cause);
    }),
  });

describe("what licensed each deletion", () => {
  test("SHADOW-I19: every deletion records the coverage kind that licensed it", () => {
    const catalog = cataloged(catalogOfPlan(identities, planForEveryCause()));

    expect(catalog.deletions.length).toBe(tombstoneCauses.length);
    for (const entry of catalog.deletions) {
      expect(entry.licensedBy).toBe("proven");
    }
  });

  test("SHADOW-I19: the unproven counter is a rendered scalar, not an absence", () => {
    const rendered = renderCatalog(
      cataloged(catalogOfPlan(identities, planForEveryCause())),
      defaultShadowLimits,
    );

    expect(rendered["shadow.deletions.unproven_count"]).toBe(0);
    expect(Object.hasOwn(rendered, "shadow.deletions.unproven_count")).toBe(true);
  });
});
