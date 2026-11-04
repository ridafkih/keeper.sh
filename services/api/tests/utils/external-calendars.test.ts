import { describe, expect, it } from "vitest";
import {
  fromGoogleCalendarListEntries,
  fromOutlookCalendarListEntries,
  toOAuthCalendarInsert,
} from "../../src/utils/external-calendars";

describe("external calendars", () => {
  it("imports a Google calendar the user can only read as a source only", () => {
    const [holidays] = fromGoogleCalendarListEntries([
      { accessRole: "reader", id: "holidays", summary: "Holidays" },
    ]);
    if (!holidays) {
      throw new Error("expected a listed calendar");
    }

    expect(toOAuthCalendarInsert("user-1", "account-1", holidays)).toEqual({
      accountId: "account-1",
      calendarType: "oauth",
      capabilities: ["pull"],
      externalCalendarId: "holidays",
      name: "Holidays",
      originalName: "Holidays",
      userId: "user-1",
    });
  });

  it("imports a Google calendar the user owns as a possible destination", () => {
    const [primary] = fromGoogleCalendarListEntries([
      { accessRole: "owner", id: "primary", summary: "Primary" },
    ]);
    if (!primary) {
      throw new Error("expected a listed calendar");
    }

    expect(toOAuthCalendarInsert("user-1", "account-1", primary).capabilities).toEqual(["pull", "push"]);
  });

  it("imports an Outlook calendar without edit rights as a source only", () => {
    const calendars = fromOutlookCalendarListEntries([
      { canEdit: false, id: "shared", name: "Shared" },
      { canEdit: true, id: "mine", name: "Mine" },
    ]);

    expect(calendars.map((calendar) => toOAuthCalendarInsert("user-1", "account-1", calendar).capabilities))
      .toEqual([["pull"], ["pull", "push"]]);
  });
});
