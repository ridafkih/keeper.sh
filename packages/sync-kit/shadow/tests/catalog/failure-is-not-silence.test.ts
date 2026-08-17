import { describe, expect, test } from "vitest";
import { defaultShadowLimits, renderCatalog, translationRefusals } from "../../src/index";
import { catalogOfPlan, cataloged, runShadow } from "../support/scenario";
import { planWith, retireTombstone } from "../support/plans";
import {
  shadowOptions,
  slotIdentity,
  syncInput,
  witnessFor,
} from "../support/fixtures";

const quiet = slotIdentity("evt-quiet", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const refusedRun = () =>
  runShadow(
    syncInput({ mappedSourceCalendars: [], witness: witnessFor([]), storedCoverage: [] }),
    shadowOptions(),
  );

describe("silence and failure never look alike", () => {
  test("SHADOW-I20: a refusal and an empty plan render different outcomes", () => {
    const quietCatalog = cataloged(catalogOfPlan([quiet], planWith({})));
    const quietRendered = renderCatalog(quietCatalog, defaultShadowLimits);
    const refusedRendered = renderCatalog(refusedRun(), defaultShadowLimits);

    expect(quietRendered["shadow.outcome"]).toBe("cataloged");
    expect(quietRendered["shadow.deletions.total"]).toBe(0);
    expect(refusedRendered["shadow.outcome"]).toBe("notTranslated");
    expect(Object.hasOwn(refusedRendered, "shadow.deletions.total")).toBe(false);
  });

  test("SHADOW-I20: every refusal reason is countable on its own", () => {
    const rendered = renderCatalog(refusedRun(), defaultShadowLimits);

    expect(rendered["shadow.not_translated_reason"]).toBe("noMappedSourceCalendars");
    expect(translationRefusals).toContain(rendered["shadow.not_translated_reason"]);
  });

  test("SHADOW-I20: a refused run reports no deletions field at all", () => {
    const catalog = refusedRun();

    expect(catalog.kind).toBe("notTranslated");
    expect(Reflect.get(catalog, "deletions")).toBeUndefined();
  });

  test("SHADOW-I20: an untranslated run still names the destination it was about", () => {
    const catalog = refusedRun();

    expect(catalog.destination.calendar.value).toBe("cal-destination");
  });

  test("SHADOW-I43: a broken shadow invariant renders as its own outcome, not as a throw", () => {
    const unclaimed = slotIdentity(
      "evt-unclaimed",
      "2026-03-11T09:00:00.000Z",
      "2026-03-11T10:00:00.000Z",
    );
    const catalog = catalogOfPlan(
      [quiet],
      planWith({ tombstones: [retireTombstone(unclaimed, "absentFromSnapshot")] }),
    );
    const rendered = renderCatalog(catalog, defaultShadowLimits);

    expect(catalog.kind).toBe("shadowRefused");
    expect(rendered["shadow.outcome"]).toBe("shadowRefused");
    expect(String(rendered["shadow.shadow_invariant"])).toContain("evt-unclaimed");
    expect(Object.hasOwn(rendered, "shadow.deletions.total")).toBe(false);
  });

  test("SHADOW-I20: a rendered refusal omits rather than zeroes the write counters", () => {
    const rendered = renderCatalog(refusedRun(), defaultShadowLimits);

    expect(Object.hasOwn(rendered, "shadow.creations.total")).toBe(false);
    expect(Object.hasOwn(rendered, "shadow.updates.total")).toBe(false);
    expect(Object.hasOwn(rendered, "shadow.replacements.total")).toBe(false);
  });
});
