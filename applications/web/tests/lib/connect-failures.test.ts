import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/lib/fetcher";
import {
  describeCalendarImportFailure,
  describeIcsFeedFailure,
  describeOAuthConnectFailure,
} from "../../src/lib/connect-failures";

const icsRejection = (body: unknown, status = 400) => new HttpError(status, "/api/ics", body);

describe("describeOAuthConnectFailure", () => {
  it("explains that a work account needs admin approval", () => {
    expect(describeOAuthConnectFailure("admin-approval-required")).toBe(
      "Your organization needs an admin to approve Keeper.sh before this account can connect.",
    );
  });

  it("says a Microsoft account without a mailbox has nothing to sync", () => {
    expect(describeOAuthConnectFailure("no-mailbox")).toBe(
      "This Microsoft account has no Outlook mailbox to sync. Connect an account with Outlook or Exchange Online.",
    );
  });

  it("falls back to a plain retry for an unrecognised reason", () => {
    expect(describeOAuthConnectFailure("something-else")).toBe(
      "Your calendar couldn't be connected. Try again.",
    );
  });
});

describe("describeIcsFeedFailure", () => {
  it("asks for a login when the feed needs one", () => {
    expect(describeIcsFeedFailure(icsRejection({ error: "x", reason: "auth-required" }))).toBe(
      "This feed needs a login. Turn on Requires authentication and add the username and password.",
    );
  });

  it("says a web page is not a calendar feed", () => {
    expect(describeIcsFeedFailure(icsRejection({ error: "x", reason: "not-calendar" }))).toBe(
      "This link opens a page, not a calendar feed. Copy the feed link instead, often ending in .ics.",
    );
  });

  it("keeps the plan message when the account limit is reached", () => {
    expect(describeIcsFeedFailure(icsRejection({ error: "Account limit reached." }, 402))).toBe(
      "Account limit reached.",
    );
  });

  it("falls back to checking the link when the cause is unknown", () => {
    expect(describeIcsFeedFailure(new Error("offline"))).toBe(
      "This feed couldn't be reached. Check the link and try again.",
    );
  });
});

describe("describeCalendarImportFailure", () => {
  it("says the calendars are already connected on a conflict", () => {
    expect(describeCalendarImportFailure(new HttpError(409, "/api/sources/caldav"))).toBe(
      "These calendars are already connected.",
    );
  });

  it("keeps the plan message when the account limit is reached", () => {
    expect(
      describeCalendarImportFailure(
        new HttpError(402, "/api/sources/caldav", { error: "Account limit reached." }),
      ),
    ).toBe("Account limit reached.");
  });

  it("falls back to a plain retry otherwise", () => {
    expect(describeCalendarImportFailure(new Error("network"))).toBe(
      "Your calendars couldn't be imported. Try again.",
    );
  });
});
