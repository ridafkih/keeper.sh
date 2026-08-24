import { describe, expect, it } from "vitest";
import { hasRequiredScopes as hasRequiredMicrosoftScopes } from "../../../src/core/oauth/microsoft";
import { hasRequiredScopes as hasRequiredGoogleScopes } from "../../../src/core/oauth/google";

describe("microsoft hasRequiredScopes", () => {
  it("accepts a short-form grant", () => {
    expect(hasRequiredMicrosoftScopes("Calendars.ReadWrite User.Read offline_access")).toBe(true);
  });

  it("accepts a fully-qualified grant", () => {
    expect(
      hasRequiredMicrosoftScopes(
        "https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access",
      ),
    ).toBe(true);
  });

  it("accepts a fully-qualified grant regardless of casing", () => {
    expect(
      hasRequiredMicrosoftScopes("https://graph.microsoft.com/calendars.readwrite offline_access"),
    ).toBe(true);
  });

  it("rejects a read-only grant in short form", () => {
    expect(hasRequiredMicrosoftScopes("Calendars.Read User.Read offline_access")).toBe(false);
  });

  it("rejects a read-only grant in fully-qualified form", () => {
    expect(
      hasRequiredMicrosoftScopes(
        "https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/User.Read",
      ),
    ).toBe(false);
  });

  it("rejects a grant whose scope merely contains the required name", () => {
    expect(hasRequiredMicrosoftScopes("NotCalendars.ReadWrite User.Read")).toBe(false);
    expect(hasRequiredMicrosoftScopes("https://contoso.example/Calendars.ReadWrite")).toBe(false);
  });

  it("rejects an empty grant", () => {
    expect(hasRequiredMicrosoftScopes("")).toBe(false);
  });
});

describe("google hasRequiredScopes", () => {
  it("accepts a grant containing the calendar events scope", () => {
    expect(
      hasRequiredGoogleScopes(
        "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email",
      ),
    ).toBe(true);
  });

  it("rejects a read-only grant", () => {
    expect(
      hasRequiredGoogleScopes(
        "https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/userinfo.email",
      ),
    ).toBe(false);
  });
});
