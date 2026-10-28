import { describe, expect, test } from "vitest";
import { decideCursor, planReconciliation } from "../../src/index";
import {
  cursorFor,
  deltaListing,
  instant,
  knownState,
  mappingSet,
  policy,
  sourceCalendar,
  sourceOnly,
  sourceScope,
} from "../support/fixtures";

const widerWindow = {
  start: instant("2025-01-01T00:00:00.000Z"),
  end: instant("2027-12-31T00:00:00.000Z"),
};

const widenedScope = { ...sourceScope, window: widerWindow };

const listingMintedUnderTheNarrowScope = () =>
  deltaListing({ events: [], cursor: cursorFor("cursor-narrow", sourceScope) });

const widenedPolicy = () => policy({ mirrorWindow: widerWindow });

describe("a cursor is valid only for the request shape that minted it", () => {
  test("RECON-O26: advancing a narrow-scope cursor under a widened policy resets instead", () => {
    const plan = planReconciliation(
      sourceOnly(listingMintedUnderTheNarrowScope()),
      knownState([]),
      mappingSet([]),
      widenedPolicy(),
    );

    expect(plan.cursor).toEqual({ kind: "reset", reason: "scopeChanged" });
  });

  test("RECON-O26: the same listing under its own scope advances normally", () => {
    const plan = planReconciliation(
      sourceOnly(listingMintedUnderTheNarrowScope()),
      knownState([]),
      mappingSet([]),
      policy(),
    );

    expect(plan.cursor.kind).toBe("advance");
  });

  test("RECON-O26: a scope change resets rather than tombstoning the span that was never listed", () => {
    const plan = planReconciliation(
      sourceOnly(listingMintedUnderTheNarrowScope()),
      knownState([]),
      mappingSet([]),
      widenedPolicy(),
    );

    expect(plan.tombstones).toEqual([]);
    expect(plan.coverage).toEqual({ kind: "unproven" });
  });

  test("RECON-O26: a cursor minted for another calendar is never reused", () => {
    const otherCalendar = { ...sourceCalendar, calendar: { kind: "calendarId" as const, value: "cal-other" } };
    const foreignScopeListing = deltaListing({
      cursor: cursorFor("cursor-elsewhere", { ...sourceScope, calendar: otherCalendar }),
    });

    expect(decideCursor(sourceOnly(foreignScopeListing), knownState([]), policy())).toEqual({
      kind: "reset",
      reason: "scopeChanged",
    });
  });

  test("RECON-O26: a recurrence-expansion change is a scope change too", () => {
    const expandedListing = deltaListing({
      scope: { ...sourceScope, expandRecurrences: true },
      cursor: cursorFor("cursor-expanded", { ...widenedScope, expandRecurrences: true }),
    });

    expect(decideCursor(sourceOnly(expandedListing), knownState([]), policy()).kind).toBe("reset");
  });
});
