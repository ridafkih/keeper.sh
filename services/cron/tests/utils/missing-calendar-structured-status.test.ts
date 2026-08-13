import { describe, expect, it } from "vitest";
import { resolveMissingCalendarFailure } from "@/utils/provider-ingest-failure";

const GRAPH_UNAUTHORIZED_BODY = JSON.stringify({
  error: {
    code: "InvalidAuthenticationToken",
    innerError: { "request-id": "9f1c404a-2b7d-49e6-9a51-1d0c8f3b7e22" },
    message: "Access token has expired or is not yet valid.",
  },
});

const eventsFetchFailure = (status: number, body: string, flags: Record<string, unknown> = {}) =>
  Object.assign(
    new Error(`Failed to fetch events: ${status}: ${body}`),
    { name: "EventsFetchError", status, ...flags },
  );

describe("resolveMissingCalendarFailure trusts the response status over the response body", () => {
  it("does not read a missing calendar out of a 401 body carrying a 404 substring", () => {
    expect(resolveMissingCalendarFailure(
      eventsFetchFailure(401, GRAPH_UNAUTHORIZED_BODY, { authRequired: true }),
    )).toBeNull();
  });

  it("does not read a missing calendar out of a rate-limit body echoing a customer uid", () => {
    expect(resolveMissingCalendarFailure(
      eventsFetchFailure(429, '{"error":{"message":"quota for 404-standup@example.com"}}'),
    )).toBeNull();
  });

  it("does not read a missing calendar out of a refresh failure that merely mentions 404", () => {
    expect(resolveMissingCalendarFailure(
      Object.assign(new Error('Token refresh failed (400): {"error":"invalid_grant","uid":"404"}'), {
        oauthReauthRequired: true,
        status: 400,
      }),
    )).toBeNull();
  });

  it("never calls a credential failure a missing calendar, whatever the status says", () => {
    const flagged = [
      Object.assign(new Error("Not Found"), { authRequired: true, status: 404 }),
      Object.assign(new Error("Not Found"), { oauthReauthRequired: true, status: 404 }),
    ];

    expect(flagged.map((error) => resolveMissingCalendarFailure(error))).toEqual([null, null]);
  });

  it("still reports a structured provider 404 and a statusCode-shaped one", () => {
    expect(resolveMissingCalendarFailure(eventsFetchFailure(404, "{}"))?.slug)
      .toBe("provider-calendar-not-found");

    expect(resolveMissingCalendarFailure(
      Object.assign(new Error("Not Found"), { statusCode: 404 }),
    )?.slug).toBe("provider-calendar-not-found");
  });

  it("still falls back to the message for a status-less CalDAV failure", () => {
    expect(resolveMissingCalendarFailure(new Error("Collection query failed: 404 Not Found"))?.slug)
      .toBe("provider-calendar-not-found");
  });
});
