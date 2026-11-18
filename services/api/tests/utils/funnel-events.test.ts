import { describe, expect, it } from "vitest";
import { describeFunnelEvent, parseFunnelEvent } from "@/utils/funnel-events";

describe("parseFunnelEvent", () => {
  it("accepts an onboarding step view", () => {
    const event = parseFunnelEvent({
      event: "onboarding.step_viewed",
      firstAccountProvider: "google",
      sameAccountCalendars: 2,
      step: "add-destination",
    });

    expect(event && describeFunnelEvent(event)).toEqual({
      "funnel.event": "onboarding.step_viewed",
      "onboarding.first_account_provider": "google",
      "onboarding.same_account_calendars": 2,
      "onboarding.step": "add-destination",
    });
  });

  it("accepts a paywall shown for a limit", () => {
    const event = parseFunnelEvent({ event: "billing.limit_shown", limitType: "accounts" });

    expect(event && describeFunnelEvent(event)).toEqual({
      "billing.limit_type": "accounts",
      "funnel.event": "billing.limit_shown",
    });
  });

  it("accepts a view of the upgrade page", () => {
    const event = parseFunnelEvent({ event: "billing.upgrade_viewed" });

    expect(event && describeFunnelEvent(event)).toEqual({ "funnel.event": "billing.upgrade_viewed" });
  });

  it("refuses unknown events, steps and limits", () => {
    expect(parseFunnelEvent({ event: "page.viewed" })).toBeNull();
    expect(parseFunnelEvent({
      event: "onboarding.step_viewed",
      firstAccountProvider: "google",
      sameAccountCalendars: 0,
      step: "somewhere",
    })).toBeNull();
    expect(parseFunnelEvent({ event: "billing.limit_shown", limitType: "everything" })).toBeNull();
  });

  it("refuses extra fields and free-form values", () => {
    expect(parseFunnelEvent({ email: "person@example.com", event: "billing.upgrade_viewed" })).toBeNull();
    expect(parseFunnelEvent({
      event: "onboarding.step_viewed",
      firstAccountProvider: "Person@Example.com",
      sameAccountCalendars: 0,
      step: "welcome",
    })).toBeNull();
    expect(parseFunnelEvent({
      event: "onboarding.step_viewed",
      firstAccountProvider: "google",
      sameAccountCalendars: 1.5,
      step: "welcome",
    })).toBeNull();
    expect(parseFunnelEvent(null)).toBeNull();
  });
});
