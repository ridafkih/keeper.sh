import { describe, expect, it } from "vitest";
import { reconcileAccountCalendars } from "../../src/utils/refresh-account-calendars";

const IMPORTED_AT = new Date("2026-01-01T00:00:00.000Z");

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
      [{
        createdAt: IMPORTED_AT,
        externalCalendarId: "ext-1",
        id: "cal-1",
        providerMissingSince: null,
      }],
    );

    expect(plan.toInsert).toEqual([]);
  });

  it("flags a previously-imported calendar the provider no longer reports", () => {
    const plan = reconcileAccountCalendars(
      [{ externalId: "ext-kept", name: "Kept Calendar" }],
      [
        {
          createdAt: IMPORTED_AT,
          externalCalendarId: "ext-kept",
          id: "cal-kept",
          providerMissingSince: null,
        },
        {
          createdAt: IMPORTED_AT,
          externalCalendarId: "ext-deleted",
          id: "cal-1",
          providerMissingSince: null,
        },
      ],
    );

    expect(plan.toMarkMissing).toEqual(["cal-1"]);
    expect(plan.toRestore).toEqual([]);
  });

  it("does not re-flag a calendar that is already marked missing", () => {
    const plan = reconcileAccountCalendars(
      [{ externalId: "ext-kept", name: "Kept Calendar" }],
      [
        {
          createdAt: IMPORTED_AT,
          externalCalendarId: "ext-kept",
          id: "cal-kept",
          providerMissingSince: null,
        },
        {
          createdAt: IMPORTED_AT,
          externalCalendarId: "ext-deleted",
          id: "cal-1",
          providerMissingSince: new Date("2026-01-01"),
        },
      ],
    );

    expect(plan.toMarkMissing).toEqual([]);
  });

  it("restores a calendar that was flagged missing but has reappeared at the provider", () => {
    const plan = reconcileAccountCalendars(
      [{ externalId: "ext-1", name: "Back Again" }],
      [{
        createdAt: IMPORTED_AT,
        externalCalendarId: "ext-1",
        id: "cal-1",
        providerMissingSince: new Date("2026-01-01"),
      }],
    );

    expect(plan.toRestore).toEqual(["cal-1"]);
    expect(plan.toMarkMissing).toEqual([]);
    expect(plan.toInsert).toEqual([]);
  });

  it("flags a calendar whose externalCalendarId was never set, since it cannot be matched against the provider list", () => {
    const plan = reconcileAccountCalendars(
      [{ externalId: "ext-kept", name: "Kept Calendar" }],
      [
        {
          createdAt: IMPORTED_AT,
          externalCalendarId: "ext-kept",
          id: "cal-kept",
          providerMissingSince: null,
        },
        {
          createdAt: IMPORTED_AT,
          externalCalendarId: null,
          id: "cal-1",
          providerMissingSince: null,
        },
      ],
    );

    expect(plan.toMarkMissing).toEqual(["cal-1"]);
  });
});
