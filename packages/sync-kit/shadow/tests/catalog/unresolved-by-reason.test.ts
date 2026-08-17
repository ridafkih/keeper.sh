import { describe, expect, test } from "vitest";
import { unresolvedReasons } from "@keeper.sh/sync-reconcile";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { catalogOfPlan, cataloged } from "../support/scenario";
import { planWith } from "../support/plans";
import { slotIdentity } from "../support/fixtures";

const identities = unresolvedReasons.map((reason) =>
  slotIdentity(`evt-${reason}`, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const everyReasonPlan = () =>
  planWith({
    unresolved: unresolvedReasons.map((reason, index) => {
      const identity = identities.at(index);
      if (!identity) {
        throw new Error(`no identity for ${reason}`);
      }
      return { identity, id: null, reason };
    }),
  });

describe("unresolved entries are kept per reason", () => {
  test("SHADOW-I18: every unresolved reason renders its own counter", () => {
    const rendered = renderCatalog(
      cataloged(catalogOfPlan(identities, everyReasonPlan())),
      defaultShadowLimits,
    );

    for (const reason of unresolvedReasons) {
      expect(rendered[`shadow.unresolved.${reason}.total`]).toBe(1);
    }
  });

  test("SHADOW-I18: no unresolved entry is folded into a residual bucket", () => {
    const rendered = renderCatalog(
      cataloged(catalogOfPlan(identities, everyReasonPlan())),
      defaultShadowLimits,
    );
    const keys = Object.keys(rendered).filter((key) => key.startsWith("shadow.unresolved."));

    expect(keys.length).toBe(unresolvedReasons.length);
    expect(keys).not.toContain("shadow.unresolved.other.total");
    expect(keys).not.toContain("shadow.unresolved.total");
  });

  test("SHADOW-I18: a reason with no entries still renders a zero", () => {
    const rendered = renderCatalog(
      cataloged(catalogOfPlan(identities, planWith({}))),
      defaultShadowLimits,
    );

    for (const reason of unresolvedReasons) {
      expect(rendered[`shadow.unresolved.${reason}.total`]).toBe(0);
    }
  });

  test("SHADOW-I18: each unresolved entry names the source calendar it came from", () => {
    const catalog = cataloged(catalogOfPlan(identities, everyReasonPlan()));

    expect(catalog.unresolved.length).toBe(unresolvedReasons.length);
    for (const entry of catalog.unresolved) {
      expect(entry.sourceCalendar.calendar.value).toBe("cal-source-a");
    }
  });
});
