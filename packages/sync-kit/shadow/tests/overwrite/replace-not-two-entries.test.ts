import { describe, expect, test } from "vitest";
import { sourceIdentityKey } from "@keeper.sh/sync-reconcile";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { catalogOfPlan, cataloged, firstOf } from "../support/scenario";
import { planWith, replaceWrite } from "../support/plans";
import { slotIdentity } from "../support/fixtures";

const drifted = slotIdentity("evt-drift", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const driftedCatalog = () =>
  cataloged(catalogOfPlan([drifted], planWith({ writes: [replaceWrite(drifted)] })));

describe("a replace is never decomposed", () => {
  test("SHADOW-O12: a drifted mirror renders one replacement and one tagged deletion", () => {
    const catalog = driftedCatalog();

    expect(catalog.replacements.length).toBe(1);
    expect(catalog.deletions.length).toBe(1);
    expect(firstOf(catalog.deletions).origin).toBe("replaceRetire");
  });

  test("SHADOW-O12: no separate creation is emitted for the replaced identity", () => {
    const catalog = driftedCatalog();

    expect(catalog.creations.map((entry) => entry.identityKey)).not.toContain(
      sourceIdentityKey(drifted),
    );
    expect(catalog.creations).toEqual([]);
  });

  test("SHADOW-O12: the replacement carries both legs so a delete cannot read as standalone", () => {
    const replacement = firstOf(driftedCatalog().replacements);

    expect(replacement.retireHandle.value.length).toBeGreaterThan(0);
    expect(replacement.recreateIdempotencyKey.value.length).toBeGreaterThan(0);
  });

  test("SHADOW-O12: the rendered deletion total is not inflated by the replace", () => {
    const rendered = renderCatalog(driftedCatalog(), defaultShadowLimits);

    expect(rendered["shadow.deletions.total"]).toBe(1);
    expect(rendered["shadow.deletions.origin.replace_retire"]).toBe(1);
    expect(rendered["shadow.replacements.total"]).toBe(1);
    expect(rendered["shadow.creations.total"]).toBe(0);
  });
});
