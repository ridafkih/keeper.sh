import { describe, expect, it } from "vitest";
import { isCalDAVAuthenticationError } from "../../../../src/providers/caldav/source/auth-error-classification";

describe("isCalDAVAuthenticationError", () => {
  it("returns true for explicit invalid-credentials errors", () => {
    expect(isCalDAVAuthenticationError(new Error("Invalid credentials"))).toBe(true);
  });

  it("returns true for structured HTTP 401 status codes", () => {
    expect(isCalDAVAuthenticationError({ status: 401 })).toBe(true);
    expect(isCalDAVAuthenticationError({ statusCode: "401" })).toBe(true);
  });

  it("returns false for 403 status codes", () => {
    expect(isCalDAVAuthenticationError({ status: 403 })).toBe(false);
    expect(isCalDAVAuthenticationError({ statusCode: "403" })).toBe(false);
  });

  it("returns false for bare 'unauthorized' in error message", () => {
    expect(isCalDAVAuthenticationError(new Error("Unauthorized"))).toBe(false);
    expect(isCalDAVAuthenticationError(new Error("unauthorized access to resource"))).toBe(false);
  });

  it("returns true for 'authentication unauthorized' in error message", () => {
    expect(isCalDAVAuthenticationError(new Error("authentication unauthorized"))).toBe(true);
  });

  it("returns true for nested auth failures", () => {
    expect(
      isCalDAVAuthenticationError({
        cause: {
          statusCode: 401,
        },
      }),
    ).toBe(true);
  });

  it("returns false for non-auth errors that contain random numbers", () => {
    expect(
      isCalDAVAuthenticationError(
        new Error("Failed query with location 401 Anderson Rd SE Calgary AB"),
      ),
    ).toBe(false);
  });

  it("returns false for non-auth operational errors", () => {
    expect(isCalDAVAuthenticationError(new Error("cannot find homeUrl"))).toBe(false);
  });

  it("returns false when our own pool rejects the connection password", () => {
    const postgresError = Object.assign(
      new Error("password authentication failed for user \"keeper\""),
      { code: "ERR_POSTGRES_SERVER_ERROR", errno: "28P01" },
    );

    expect(isCalDAVAuthenticationError(postgresError)).toBe(false);
  });

  it("returns false when a wrapped pool failure surfaces as the cause", () => {
    const postgresError = Object.assign(
      new Error("password authentication failed for user \"keeper\""),
      { code: "ERR_POSTGRES_SERVER_ERROR", errno: "28P01" },
    );
    const wrapped = new Error("Failed query", { cause: postgresError });

    expect(isCalDAVAuthenticationError(wrapped)).toBe(false);
  });
});
