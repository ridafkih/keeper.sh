import { isDatabaseError } from "@keeper.sh/database";
import { describe, expect, it } from "vitest";
import { isCalDAVAuthenticationError } from "../../../../src/providers/caldav/source/auth-error-classification";

const passwordAuthFailure = (): Error =>
  Object.assign(new Error('password authentication failed for user "keeper"'), {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "28P01",
    name: "PostgresError",
  });

const wrapInCauses = (error: unknown, layers: number): unknown => {
  let wrapped = error;
  for (let layer = 0; layer < layers; layer += 1) {
    wrapped = new Error(`ingest layer ${layer} failed`, { cause: wrapped });
  }
  return wrapped;
};

describe("isCalDAVAuthenticationError never claims a Postgres failure", () => {
  it("stays false at every cause depth the wide event can carry", () => {
    const depths = [0, 1, 2, 3, 4, 5, 6, 7];

    expect(depths.map((depth) => isCalDAVAuthenticationError(wrapInCauses(passwordAuthFailure(), depth))))
      .toEqual(depths.map(() => false));
  });

  it("agrees with the database guard it is built on at every depth", () => {
    const depths = [0, 1, 2, 3, 4, 5, 6, 7];
    const chains = depths.map((depth) => wrapInCauses(passwordAuthFailure(), depth));

    expect(chains.map((chain) => isDatabaseError(chain)))
      .toEqual(chains.map(() => true));
  });

  it("stays false when the Postgres failure is carried outside the cause chain", () => {
    const shapes: unknown[] = [
      Object.assign(new Error("caldav ingest failed"), { error: passwordAuthFailure() }),
      Object.assign(new Error("caldav ingest failed"), { errors: [passwordAuthFailure()] }),
      Object.assign(new Error("caldav ingest failed"), { Error: passwordAuthFailure() }),
    ];

    expect(shapes.map((shape) => isCalDAVAuthenticationError(shape)))
      .toEqual(shapes.map(() => false));
  });

  it("is stable across repeated evaluation of the same incident", () => {
    const incident = wrapInCauses(passwordAuthFailure(), 5);

    expect(Array.from({ length: 4 }, () => isCalDAVAuthenticationError(incident)))
      .toEqual([false, false, false, false]);
  });

  it("still recognises a genuine CalDAV 401 nested behind the same depth", () => {
    const unauthorized = Object.assign(new Error("Invalid credentials"), { status: 401 });

    expect(isCalDAVAuthenticationError(wrapInCauses(unauthorized, 5))).toBe(true);
  });
});
