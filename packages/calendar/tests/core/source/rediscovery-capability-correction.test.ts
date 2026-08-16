import { describe, expect, it } from "vitest";
import {
  planCalendarRediscovery,
  toExistingCalendars,
} from "../../../src/core/source/calendar-rediscovery";
import type {
  DiscoveredCalendar,
  StoredCalendarRow,
} from "../../../src/core/source/calendar-rediscovery";

const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
const CALENDAR_ID = "calendar-id-1";
const EXTERNAL_ID = "team@group.calendar.google.com";

const storedRow = (capabilities: string[]): StoredCalendarRow => ({
  calendarUrl: null,
  capabilities,
  createdAt: CREATED_AT,
  externalCalendarId: EXTERNAL_ID,
  id: CALENDAR_ID,
  unavailableSince: null,
});

const discovered = (writable: boolean): DiscoveredCalendar => ({
  calendarUrl: null,
  externalCalendarId: EXTERNAL_ID,
  identityKey: EXTERNAL_ID,
  name: "Team calendar",
  writable,
});

const planFor = (stored: string[], writable: boolean) => planCalendarRediscovery({
  discovered: [discovered(writable)],
  existing: toExistingCalendars([storedRow(stored)], "oauth"),
});

describe("rediscovery corrects what a stored calendar claims it can do", () => {
  /*
   * The column is written on insert and nothing has ever revised it, so a calendar
   * connected before the write-back gate existed still claims it can be written to. The
   * gate reads that column, so the dashboard would offer two-way sync on a calendar the
   * provider refuses every write to.
   */
  it("demotes a calendar the provider now reports as read-only", () => {
    const plan = planFor(["pull", "push"], false);

    expect(plan.toUpdateCapabilities).toEqual([
      { capabilities: ["pull"], id: CALENDAR_ID },
    ]);
  });

  it("promotes a calendar the provider now reports as writable", () => {
    const plan = planFor(["pull"], true);

    expect(plan.toUpdateCapabilities).toEqual([
      { capabilities: ["pull", "push"], id: CALENDAR_ID },
    ]);
  });

  it("leaves a calendar whose stored capabilities already agree", () => {
    expect(planFor(["pull", "push"], true).toUpdateCapabilities).toEqual([]);
    expect(planFor(["pull"], false).toUpdateCapabilities).toEqual([]);
  });

  /*
   * A listing that came back empty is an outage, not an account with no calendars, and
   * the plan already refuses to act on one. Rewriting capabilities from it would strip
   * write-back from every calendar of the account at once.
   */
  it("corrects nothing when the listing is suppressed", () => {
    const plan = planCalendarRediscovery({
      discovered: [],
      existing: toExistingCalendars([storedRow(["pull", "push"])], "oauth"),
    });

    expect(plan.suppressed).toBe(true);
    expect(plan.toUpdateCapabilities).toEqual([]);
  });
});
