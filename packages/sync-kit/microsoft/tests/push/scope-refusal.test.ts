import { describe, expect, test } from "vitest";
import { resourcePathOf, subscriptionScopeOf } from "../../src/push/subscription";
import { microsoftCalendar } from "../support/harness";

describe("a calendar with no provider account id is withheld, never registered against /me", () => {
  test("MS-P17: a calendar with no provider account id is withheld with its reason", () => {
    const withheld = subscriptionScopeOf({
      providerAccountId: null,
      calendar: microsoftCalendar.calendar,
    });

    expect(withheld).toEqual({ kind: "withheld", reason: "missingProviderAccountId" });
  });

  test("MS-P17: a scoped subscription names the account in its resource path", () => {
    const scoped = subscriptionScopeOf({
      providerAccountId: "mailbox-one",
      calendar: microsoftCalendar.calendar,
    });

    if (scoped.kind !== "scoped") {
      throw new Error("a scope with a provider account id was withheld");
    }
    const path = resourcePathOf(scoped.scope, "events");
    expect(path).toBe("users/mailbox-one/calendars/AAMkAGVmMDEz/events");
    expect(path).not.toContain("/me/");
  });
});
