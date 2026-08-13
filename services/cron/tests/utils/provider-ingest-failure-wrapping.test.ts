import { describe, expect, it } from "vitest";
import {
  CalDAVAuthenticationError,
  CalDAVIncompleteMultiGetError,
} from "@keeper.sh/calendar/caldav";
import { RequestTimeoutError } from "@keeper.sh/calendar";
import { shouldTreatAsProviderAuthFailure } from "../../src/utils/provider-ingest-failure";

const redisNoAuth = (): Error => {
  const error = new Error("NOAUTH Authentication required.");
  error.name = "ReplyError";
  return error;
};

const postgresCredentialRejection = (): Error =>
  new Error("Failed query", {
    cause: Object.assign(new Error("password authentication failed for user \"keeper\""), {
      code: "28P01",
      name: "PostgresError",
    }),
  });

const errorWithoutMessage = (): Error => Object.assign(new Error("unused"), { message: "" });

const verdictsAcross = (runs: number, error: unknown): boolean[] =>
  Array.from({ length: runs }, () => shouldTreatAsProviderAuthFailure(error));

describe("provider ingest failure attribution under wrapping and repetition", () => {
  it("gives the same verdict every time it judges the same error", () => {
    expect(verdictsAcross(3, new CalDAVAuthenticationError(new Error("Invalid credentials"))))
      .toEqual([true, true, true]);
    expect(verdictsAcross(3, redisNoAuth())).toEqual([false, false, false]);
    expect(verdictsAcross(3, new RequestTimeoutError(90_000))).toEqual([false, false, false]);
    expect(verdictsAcross(3, postgresCredentialRejection())).toEqual([false, false, false]);
  });

  it("still blames the credentials when the CalDAV 401 is wrapped by an outer error", () => {
    const wrapped = new Error("source ingest failed", {
      cause: new CalDAVAuthenticationError(new Error("Invalid credentials")),
    });

    expect(shouldTreatAsProviderAuthFailure(wrapped)).toBe(true);
  });

  it("does not blame the credentials for a wrapped incomplete multiget", () => {
    const incomplete = new CalDAVIncompleteMultiGetError({
      batchCount: 1,
      calendarUrl: "https://caldav.example.test/cal/u/personal/",
      hrefsRequested: 2,
      missingHrefs: ["/cal/u/personal/event-0002.ics"],
      objectsReturned: 1,
    });

    expect(shouldTreatAsProviderAuthFailure(incomplete)).toBe(false);
    expect(shouldTreatAsProviderAuthFailure(new Error("ingest failed", { cause: incomplete })))
      .toBe(false);
  });

  it("does not blame the credentials for absent or empty failures", () => {
    expect(shouldTreatAsProviderAuthFailure(null)).toBe(false);
    expect(shouldTreatAsProviderAuthFailure(globalThis.undefined)).toBe(false);
    expect(shouldTreatAsProviderAuthFailure("")).toBe(false);
    expect(shouldTreatAsProviderAuthFailure({})).toBe(false);
    expect(shouldTreatAsProviderAuthFailure(errorWithoutMessage())).toBe(false);
  });

  it("reads a 401 carried as a string status the same way as a numeric one", () => {
    expect(shouldTreatAsProviderAuthFailure(Object.assign(new Error("failed"), { status: 401 })))
      .toBe(true);
    expect(shouldTreatAsProviderAuthFailure(Object.assign(new Error("failed"), { status: "401" })))
      .toBe(true);
    expect(shouldTreatAsProviderAuthFailure(Object.assign(new Error("failed"), { status: 403 })))
      .toBe(false);
  });

  it("blames the credentials for a 401 reported alongside the server's port", () => {
    const error = new Error(
      "Invalid credentials for https://caldav.example.test:443/principals/user/",
    );

    expect(shouldTreatAsProviderAuthFailure(error)).toBe(true);
  });

  it("does not blame the credentials when a lock failure is reported alongside a CalDAV timeout", () => {
    const renewal = new Error("Failed to renew sync lock for calendar cal-1", {
      cause: redisNoAuth(),
    });
    renewal.name = "SyncLockRenewalError";

    expect(shouldTreatAsProviderAuthFailure(renewal)).toBe(false);
    expect(shouldTreatAsProviderAuthFailure(new Error("ingest failed", { cause: renewal })))
      .toBe(false);
  });
});
