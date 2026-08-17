import { describe, expect, test } from "vitest";
import { classifyGoogleError, isRetryable } from "../../src/errors/classify";

const forbidden = (reason: string) => ({ status: 403, reasons: [reason], retryAfter: null });

describe("classification reads the status and the reason together", () => {
  test("GOOG-O25: a 403 rateLimitExceeded and a 403 authError classify differently", () => {
    const throttled = classifyGoogleError(forbidden("rateLimitExceeded"), "listChanges");
    const reauth = classifyGoogleError(forbidden("authError"), "listChanges");

    expect(throttled.kind).toBe("rateLimited");
    expect(reauth.kind).toBe("authExpired");
  });

  test("GOOG-O25: retryability is a property of the classification, not of the status", () => {
    expect(isRetryable(classifyGoogleError(forbidden("userRateLimitExceeded"), "listChanges"))).toBe(
      true,
    );
    expect(
      isRetryable(classifyGoogleError(forbidden("accessTokenScopeInsufficient"), "listChanges")),
    ).toBe(false);
  });

  test("GOOG-O25: an unknown reason on a 403 is permanent rather than a retry storm", () => {
    const classified = classifyGoogleError(forbidden("somethingNew"), "listChanges");

    expect(classified.kind).toBe("permanent");
    expect(isRetryable(classified)).toBe(false);
  });
});
