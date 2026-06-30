import { describe, expect, it } from "vitest";
import { resolveMissingCalendarFailure } from "../../src/utils/provider-ingest-failure";

describe("resolveMissingCalendarFailure", () => {
  it("keeps a missing provider calendar retriable without globally disabling it", () => {
    const policy = resolveMissingCalendarFailure(new Error("Collection query failed: 404 Not Found"));

    expect(policy).toEqual({
      disableCalendar: false,
      retriable: true,
      slug: "provider-calendar-not-found",
    });
  });

  it("does not classify unrelated provider errors as a missing calendar", () => {
    expect(resolveMissingCalendarFailure(new Error("HTTP 500"))).toBeNull();
  });
});
