import { RequestTimeoutError } from "@keeper.sh/calendar";
import { CalDAVAuthenticationError, CalDAVWithheldCredentialsError } from "@keeper.sh/calendar/caldav";
import { describe, expect, it } from "vitest";
import { shouldTreatAsProviderAuthFailure } from "../../src/utils/provider-ingest-failure";

const redisReplyError = (message: string): Error =>
  Object.assign(new Error(message), { command: { args: [], name: "eval" }, name: "ReplyError" });

const syncLockRenewalError = (cause: unknown): Error =>
  Object.assign(
    new Error("Failed to renew sync lock for calendar cal-1", { cause }),
    { name: "SyncLockRenewalError" },
  );

const postgresError = (message: string, sqlState: string): Error =>
  Object.assign(new Error(message), { code: sqlState, errno: sqlState, name: "PostgresError" });

const errorWithoutMessage = (): Error => Object.assign(new Error("unused"), { message: "" });

const classifyRepeatedly = (error: unknown, runs: number): boolean[] =>
  Array.from({ length: runs }, () => shouldTreatAsProviderAuthFailure(error));

describe("shouldTreatAsProviderAuthFailure with infrastructure failures", () => {
  it("does not blame the customer when our own Redis rejects the lock command", () => {
    expect(shouldTreatAsProviderAuthFailure(redisReplyError("NOAUTH Authentication required.")))
      .toBe(false);
  });

  it("does not blame the customer when a Redis rejection is wrapped in a lock renewal error", () => {
    const error = syncLockRenewalError(redisReplyError("NOAUTH Authentication required."));

    expect(shouldTreatAsProviderAuthFailure(error)).toBe(false);
  });

  it("does not blame the customer when our egress proxy demands authentication", () => {
    const error = new Error(
      "Collection query failed: 407 Proxy Authentication Required. Raw response: <html>407</html>",
    );

    expect(shouldTreatAsProviderAuthFailure(error)).toBe(false);
  });
});

describe("shouldTreatAsProviderAuthFailure on a redirect that withheld our credentials", () => {
  it("does not flag the account for reauthentication", () => {
    const error = new CalDAVWithheldCredentialsError(
      { redirectedTo: "https://dav.other-provider.test/principals/" },
      new Error("Invalid credentials"),
    );

    expect(shouldTreatAsProviderAuthFailure(error)).toBe(false);
  });
});

describe("shouldTreatAsProviderAuthFailure on genuine provider failures", () => {
  it("still recognises the client's own authentication error", () => {
    expect(shouldTreatAsProviderAuthFailure(new CalDAVAuthenticationError(new Error("401")))).toBe(true);
  });

  it("still recognises a 401 reported through a transport error carrying a socket code", () => {
    const cause = Object.assign(new Error("Collection query failed: 401 Unauthorized."), {
      code: "EPIPE",
      status: 401,
    });

    expect(shouldTreatAsProviderAuthFailure(new CalDAVAuthenticationError(cause))).toBe(true);
  });
});

describe("shouldTreatAsProviderAuthFailure convergence and edges", () => {
  it("returns the same verdict on every repeated run for the same error", () => {
    const authError = new CalDAVAuthenticationError(new Error("401"));
    const dbError = postgresError('password authentication failed for user "keeper"', "28P01");
    const timeout = new RequestTimeoutError(90_000);

    expect(classifyRepeatedly(authError, 5)).toEqual([true, true, true, true, true]);
    expect(classifyRepeatedly(dbError, 5)).toEqual([false, false, false, false, false]);
    expect(classifyRepeatedly(timeout, 5)).toEqual([false, false, false, false, false]);
  });

  it("terminates on a cause chain that points back at itself", () => {
    const outer: { cause?: unknown; message: string } = { message: "outer" };
    const inner = { cause: outer, message: "inner", status: 401 };
    outer.cause = inner;

    expect(shouldTreatAsProviderAuthFailure(outer)).toBe(true);
  });

  it("treats absent and empty failures as not a provider auth failure", () => {
    for (const value of [null, globalThis.undefined, "", 0, {}, [], errorWithoutMessage()]) {
      expect(shouldTreatAsProviderAuthFailure(value)).toBe(false);
    }
  });

  it("does not read a sqlstate-shaped value of the wrong length as a database failure", () => {
    const nearMisses = [
      Object.assign(new Error("Unauthorized"), { code: "28", status: 401 }),
      Object.assign(new Error("Unauthorized"), { code: "280001", status: 401 }),
      Object.assign(new Error("Unauthorized"), { errno: 28_000, status: 401 }),
    ];

    expect(nearMisses.map((error) => shouldTreatAsProviderAuthFailure(error)))
      .toEqual([true, true, true]);
  });

  it("agrees with itself about whether a lowercase sqlstate-shaped code is a database failure", () => {
    const error = Object.assign(new Error("Unauthorized"), { code: "28p01", status: 401 });

    expect(shouldTreatAsProviderAuthFailure(error)).toBe(true);
  });
});
