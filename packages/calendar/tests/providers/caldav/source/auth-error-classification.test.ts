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

  it("returns false for a Postgres 28P01 credential rejection", () => {
    const cause = Object.assign(
      new Error('password authentication failed for user "keeper"'),
      { code: "28P01", errno: "28P01", name: "PostgresError" },
    );

    expect(isCalDAVAuthenticationError(cause)).toBe(false);
    expect(isCalDAVAuthenticationError(new Error("Failed query", { cause }))).toBe(false);
  });

  it("returns true for the bare 401 error tsdav raises from a principal propfind", () => {
    expect(isCalDAVAuthenticationError(new Error("Collection query failed: 401 Unauthorized."))).toBe(true);
  });

  it("returns false for a Redis reply demanding authentication", () => {
    const replyError = Object.assign(new Error("NOAUTH Authentication required."), {
      command: { args: [], name: "eval" },
      name: "ReplyError",
    });

    expect(isCalDAVAuthenticationError(replyError)).toBe(false);
    expect(isCalDAVAuthenticationError(
      Object.assign(new Error("Failed to renew sync lock for calendar cal-1", { cause: replyError }), {
        name: "SyncLockRenewalError",
      }),
    )).toBe(false);
  });

  it("returns false when the message reports a non-401 HTTP status", () => {
    expect(isCalDAVAuthenticationError(new Error(
      "Collection query failed: 407 Proxy Authentication Required. Raw response: <html>407</html>",
    ))).toBe(false);
    expect(isCalDAVAuthenticationError(new Error(
      "Collection query failed: 511 Network Authentication Required.",
    ))).toBe(false);
  });

  it("returns false for a Postgres pg_hba rejection", () => {
    const cause = Object.assign(
      new Error('no pg_hba.conf entry for host "10.0.0.4", SSL off'),
      { code: "28000", errno: "28000", name: "PostgresError" },
    );

    expect(isCalDAVAuthenticationError(new Error("Failed query", { cause }))).toBe(false);
  });
});
