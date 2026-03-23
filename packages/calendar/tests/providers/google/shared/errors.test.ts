import { describe, expect, it } from "bun:test";
import { isAuthError, isRateLimitApiError, isRateLimitResponseStatus } from "../../../../src/providers/google/shared/errors";

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
