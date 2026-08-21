import { describe, expect, it } from "vitest";
import { reconcileAccountCalendars } from "../../src/utils/refresh-account-calendars";

const ENUMERATION_STARTED_AT = new Date("2026-03-01T10:00:00.000Z");
const BEFORE_ENUMERATION = new Date("2026-03-01T09:00:00.000Z");
const AFTER_ENUMERATION = new Date("2026-03-01T10:00:30.000Z");

describe("reconcileAccountCalendars condemnation guards", () => {
  it("flags nothing when the provider listing comes back empty while calendars exist", () => {
    const plan = reconcileAccountCalendars(
      [],
      [
        {
          createdAt: BEFORE_ENUMERATION,
          externalCalendarId: "ext-1",
          id: "cal-1",
          providerMissingSince: null,
        },
        {
          createdAt: BEFORE_ENUMERATION,
          externalCalendarId: "ext-2",
          id: "cal-2",
          providerMissingSince: null,
        },
      ],
      { enumerationStartedAt: ENUMERATION_STARTED_AT },
    );

    expect(plan.toMarkMissing).toEqual([]);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toRestore).toEqual([]);
  });

  it("never flags a row created after the enumeration began", () => {
    const plan = reconcileAccountCalendars(
      [{ externalId: "ext-1", name: "Still There" }],
      [
        {
          createdAt: BEFORE_ENUMERATION,
          externalCalendarId: "ext-1",
          id: "cal-1",
          providerMissingSince: null,
        },
        {
          createdAt: AFTER_ENUMERATION,
          externalCalendarId: "ext-raced",
          id: "cal-raced",
          providerMissingSince: null,
        },
      ],
      { enumerationStartedAt: ENUMERATION_STARTED_AT },
    );

    expect(plan.toMarkMissing).toEqual([]);
  });

  it("still flags a row that predates the enumeration when the listing is partial", () => {
    const plan = reconcileAccountCalendars(
      [{ externalId: "ext-1", name: "Still There" }],
      [
        {
          createdAt: BEFORE_ENUMERATION,
          externalCalendarId: "ext-1",
          id: "cal-1",
          providerMissingSince: null,
        },
        {
          createdAt: BEFORE_ENUMERATION,
          externalCalendarId: "ext-gone",
          id: "cal-gone",
          providerMissingSince: null,
        },
      ],
      { enumerationStartedAt: ENUMERATION_STARTED_AT },
    );

    expect(plan.toMarkMissing).toEqual(["cal-gone"]);
  });
});
