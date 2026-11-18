import { describe, expect, it } from "vitest";
import {
  GoogleBatchApiError,
  GoogleCalendarApiError,
  isAuthError,
  isGoogleWriteAccessDeniedError,
  isRateLimitApiError,
  isRateLimitResponseStatus,
} from "../../../../src/providers/google/shared/errors";

describe("isAuthError", () => {
  it("returns true for unauthenticated 401 responses", () => {
    expect(isAuthError(401, { status: "UNAUTHENTICATED" })).toBe(true);
  });

  it("returns false for generic permission denied responses", () => {
    expect(
      isAuthError(403, {
        message: "The caller does not have permission",
        status: "PERMISSION_DENIED",
      }),
    ).toBe(false);
  });

  it("returns true for legacy insufficientPermissions reasons", () => {
    expect(
      isAuthError(403, {
        status: "PERMISSION_DENIED",
        errors: [{ reason: "insufficientPermissions" }],
      }),
    ).toBe(true);
  });

  it("returns true for google rpc ACCESS_TOKEN_SCOPE_INSUFFICIENT reasons", () => {
    expect(
      isAuthError(403, {
        status: "PERMISSION_DENIED",
        details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
      }),
    ).toBe(true);
  });
});

describe("isRateLimitResponseStatus", () => {
  it("returns true for 403", () => {
    expect(isRateLimitResponseStatus(403)).toBe(true);
  });

  it("returns true for 429", () => {
    expect(isRateLimitResponseStatus(429)).toBe(true);
  });

  it("returns false for 401", () => {
    expect(isRateLimitResponseStatus(401)).toBe(false);
  });

  it("returns false for 500", () => {
    expect(isRateLimitResponseStatus(500)).toBe(false);
  });
});

describe("isRateLimitApiError", () => {
  it("returns true for 429 regardless of error body", () => {
    expect(isRateLimitApiError(429)).toBe(true);
    expect(isRateLimitApiError(429, {})).toBe(true);
  });

  it("returns true for 403 with legacy rateLimitExceeded reason", () => {
    expect(
      isRateLimitApiError(403, {
        errors: [{ reason: "rateLimitExceeded" }],
      }),
    ).toBe(true);
  });

  it("returns true for 403 with legacy userRateLimitExceeded reason", () => {
    expect(
      isRateLimitApiError(403, {
        errors: [{ reason: "userRateLimitExceeded" }],
      }),
    ).toBe(true);
  });

  it("returns true for 403 with ErrorInfo RATE_LIMIT_EXCEEDED reason", () => {
    expect(
      isRateLimitApiError(403, {
        details: [{ reason: "RATE_LIMIT_EXCEEDED" }],
      }),
    ).toBe(true);
  });

  it("returns true for 403 with rateLimitExceeded in message", () => {
    expect(
      isRateLimitApiError(403, {
        message: "Quota exceeded for quota metric 'Queries'... rateLimitExceeded",
      }),
    ).toBe(true);
  });

  it("returns false for 403 with unrelated PERMISSION_DENIED reason", () => {
    expect(
      isRateLimitApiError(403, {
        status: "PERMISSION_DENIED",
        errors: [{ reason: "insufficientPermissions" }],
      }),
    ).toBe(false);
  });

  it("returns false for 403 with no rate limit indicators", () => {
    expect(
      isRateLimitApiError(403, {
        message: "The caller does not have permission",
      }),
    ).toBe(false);
  });

  it("returns false for non-rate-limit status codes", () => {
    expect(isRateLimitApiError(401, { errors: [{ reason: "rateLimitExceeded" }] })).toBe(false);
    expect(isRateLimitApiError(500, { errors: [{ reason: "rateLimitExceeded" }] })).toBe(false);
  });
});

const WRITER_ACCESS_BODY = JSON.stringify({
  error: {
    code: 403,
    errors: [{
      domain: "calendar",
      message: "You need to have writer access to this calendar.",
      reason: "requiredAccessLevel",
    }],
    message: "You need to have writer access to this calendar.",
  },
});

describe("isGoogleWriteAccessDeniedError", () => {
  it("recognises a calendar refusing writes from the API response reason", () => {
    expect(isGoogleWriteAccessDeniedError(new GoogleCalendarApiError(403, WRITER_ACCESS_BODY))).toBe(true);
  });

  it("recognises a whole batch refused for missing writer access", () => {
    expect(isGoogleWriteAccessDeniedError(new GoogleBatchApiError(403, WRITER_ACCESS_BODY))).toBe(true);
  });

  it("does not treat a rate-limited 403 as missing writer access", () => {
    const body = JSON.stringify({
      error: { code: 403, errors: [{ reason: "rateLimitExceeded" }], message: "Rate Limit Exceeded" },
    });
    expect(isGoogleWriteAccessDeniedError(new GoogleCalendarApiError(403, body))).toBe(false);
  });

  it("ignores a plain error that only quotes the writer access message", () => {
    expect(isGoogleWriteAccessDeniedError(new Error("You need to have writer access to this calendar."))).toBe(false);
  });
});
