import { describe, expect, it } from "vitest";
import { CalDAVWithheldCredentialsError } from "../../../../src/providers/caldav/shared/client";
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

  it("returns true when the only [45]xx-shaped number is the server's port", () => {
    expect(isCalDAVAuthenticationError(new Error(
      "Invalid credentials for https://caldav.example.test:443/principals/user/",
    ))).toBe(true);
    expect(isCalDAVAuthenticationError(new Error(
      "Authentication required by https://caldav.example.test:465/cal/u/",
    ))).toBe(true);
  });

  it("returns false when a non-401 status sits in HTTP-status position anywhere in the message", () => {
    expect(isCalDAVAuthenticationError(new Error(
      "Invalid credentials for https://caldav.example.test:443/ (status 502)",
    ))).toBe(false);
    expect(isCalDAVAuthenticationError(new Error(
      "Authentication required. Server replied HTTP/1.1 511 Network Authentication Required",
    ))).toBe(false);
    expect(isCalDAVAuthenticationError(new Error(
      "Collection query failed with 407 Proxy Authentication Required",
    ))).toBe(false);
  });

  it("returns false for a Postgres pg_hba rejection", () => {
    const cause = Object.assign(
      new Error('no pg_hba.conf entry for host "10.0.0.4", SSL off'),
      { code: "28000", errno: "28000", name: "PostgresError" },
    );

    expect(isCalDAVAuthenticationError(new Error("Failed query", { cause }))).toBe(false);
  });

  it("returns false for a redirect that withheld our credentials, even though the transport said Invalid credentials", () => {
    const withheld = new CalDAVWithheldCredentialsError(
      { redirectedTo: "https://dav.other-provider.test/principals/" },
      new Error("Invalid credentials"),
    );

    expect(isCalDAVAuthenticationError(withheld)).toBe(false);
    expect(isCalDAVAuthenticationError(new Error("Failed query", { cause: withheld }))).toBe(false);
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
