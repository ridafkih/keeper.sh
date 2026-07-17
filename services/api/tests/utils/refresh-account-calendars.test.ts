import { describe, expect, it } from "vitest";
import { reconcileAccountCalendars } from "../../src/utils/refresh-account-calendars";

describe("reconcileAccountCalendars", () => {
  it("imports calendars reported by the provider that were never imported before", () => {
    const plan = reconcileAccountCalendars(
      [{ externalId: "ext-1", name: "New Calendar" }],
      [],
    );

    expect(plan.toInsert).toEqual([{ externalId: "ext-1", name: "New Calendar" }]);
    expect(plan.toMarkMissing).toEqual([]);
    expect(plan.toRestore).toEqual([]);
  });

  it("does not re-import a calendar that is already tracked", () => {
    const plan = reconcileAccountCalendars(
      [{ externalId: "ext-1", name: "Existing Calendar" }],
      [{ externalCalendarId: "ext-1", id: "cal-1", providerMissingSince: null }],
    );

    expect(plan.toInsert).toEqual([]);
  });

  it("flags a previously-imported calendar the provider no longer reports", () => {
    const plan = reconcileAccountCalendars(
      [],
      [{ externalCalendarId: "ext-deleted", id: "cal-1", providerMissingSince: null }],
    );

    expect(plan.toMarkMissing).toEqual(["cal-1"]);
    expect(plan.toRestore).toEqual([]);
  });

  it("does not re-flag a calendar that is already marked missing", () => {
    const plan = reconcileAccountCalendars(
      [],
      [{ externalCalendarId: "ext-deleted", id: "cal-1", providerMissingSince: new Date("2026-01-01") }],
    );

    expect(plan.toMarkMissing).toEqual([]);
  });

  it("restores a calendar that was flagged missing but has reappeared at the provider", () => {
    const plan = reconcileAccountCalendars(
      [{ externalId: "ext-1", name: "Back Again" }],
      [{ externalCalendarId: "ext-1", id: "cal-1", providerMissingSince: new Date("2026-01-01") }],
    );

    expect(plan.toRestore).toEqual(["cal-1"]);
    expect(plan.toMarkMissing).toEqual([]);
    expect(plan.toInsert).toEqual([]);
  });

  it("flags a calendar whose externalCalendarId was never set, since it cannot be matched against the provider list", () => {
    const plan = reconcileAccountCalendars(
      [],
      [{ externalCalendarId: null, id: "cal-1", providerMissingSince: null }],
    );

    expect(plan.toMarkMissing).toEqual(["cal-1"]);
  });
});
