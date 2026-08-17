import { describe, expect, test } from "vitest";
import { sourceIdentityKey } from "@keeper.sh/sync-reconcile";
import { catalogOfPlan, cataloged, firstOf } from "../support/scenario";
import { planWith, replaceWrite, updateWrite } from "../support/plans";
import { slotIdentity } from "../support/fixtures";

const drifted = slotIdentity("evt-drift", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const repaired = slotIdentity("evt-repair", "2026-03-11T09:00:00.000Z", "2026-03-11T10:00:00.000Z");

describe("a replace is one entry", () => {
  test("SHADOW-I13: a replace renders as one entry carrying both legs", () => {
    const catalog = cataloged(
      catalogOfPlan([drifted], planWith({ writes: [replaceWrite(drifted)] })),
    );
    const replacement = firstOf(catalog.replacements);

    expect(catalog.replacements.length).toBe(1);
    expect(replacement.identityKey).toBe(sourceIdentityKey(drifted));
    expect(replacement.retireHandle.value).toBe("handle-evt-drift");
    expect(replacement.recreateIdempotencyKey.value).toBe("idem-evt-drift");
  });

  test("SHADOW-I13: the retire leg is counted once, and no creation is duplicated for it", () => {
    const catalog = cataloged(
      catalogOfPlan([drifted], planWith({ writes: [replaceWrite(drifted)] })),
    );

    expect(catalog.deletions.length).toBe(1);
    expect(firstOf(catalog.deletions).origin).toBe("replaceRetire");
    expect(catalog.creations.map((entry) => entry.identityKey)).not.toContain(
      sourceIdentityKey(drifted),
    );
  });

  test("SHADOW-I13: a reassignment with no provider write is not a deletion", () => {
    const catalog = cataloged(catalogOfPlan([repaired], planWith({ writes: [] })));

    expect(catalog.deletions).toEqual([]);
    expect(catalog.replacements).toEqual([]);
    expect(catalog.creations).toEqual([]);
  });

  test("SHADOW-I13: a plain update is an update, never a deletion", () => {
    const catalog = cataloged(
      catalogOfPlan([repaired], planWith({ writes: [updateWrite(repaired)] })),
    );

    expect(catalog.deletions).toEqual([]);
    expect(catalog.updates.length).toBe(1);
    expect(firstOf(catalog.updates).target.value).toBe("mirror-evt-repair");
  });
});
