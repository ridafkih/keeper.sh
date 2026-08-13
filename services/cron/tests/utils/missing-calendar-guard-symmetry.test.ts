import { isDatabaseError } from "@keeper.sh/database";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { resolveMissingCalendarFailure } from "@/utils/provider-ingest-failure";

const UPSERT_SQL =
  'insert into "events" ("id", "calendar_id", "uid") values ($1, $2, $3) '
  + 'on conflict ("calendar_id", "uid") do update set "uid" = $3';

const CUSTOMER_UID = "meeting-404-not-found@fastmail.com";

const deadlock = (): Error =>
  Object.assign(new Error("deadlock detected"), {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "40P01",
    name: "PostgresError",
  });

const failingUpsert = (): DrizzleQueryError =>
  new DrizzleQueryError(UPSERT_SQL, ["event-1", "calendar-1", CUSTOMER_UID], deadlock());

const wrapInCauses = (error: unknown, layers: number): Error => {
  let wrapped = error;
  for (let layer = 0; layer < layers; layer += 1) {
    wrapped = new Error(
      `ingest failed for ${CUSTOMER_UID} at layer ${layer}`,
      { cause: wrapped },
    );
  }
  return wrapped as Error;
};

describe("resolveMissingCalendarFailure never blames the provider for our writes", () => {
  it("ignores a failing upsert whose bound parameters contain 404", () => {
    expect(resolveMissingCalendarFailure(failingUpsert())).toBeNull();
  });

  it("ignores that failure at every cause depth the ingest path can produce", () => {
    const depths = [0, 1, 2, 3, 4, 5, 6];

    expect(depths.map((depth) => resolveMissingCalendarFailure(wrapInCauses(failingUpsert(), depth))))
      .toEqual(depths.map(() => null));
  });

  it("keeps the database guard true for the same chains", () => {
    const depths = [0, 1, 2, 3, 4, 5, 6];

    expect(depths.map((depth) => isDatabaseError(wrapInCauses(failingUpsert(), depth))))
      .toEqual(depths.map(() => true));
  });

  it("is stable when the same incident is classified more than once", () => {
    const incident = wrapInCauses(failingUpsert(), 5);

    expect(Array.from({ length: 3 }, () => resolveMissingCalendarFailure(incident)))
      .toEqual([null, null, null]);
  });

  it("still reports a genuine provider 404", () => {
    const notFound = Object.assign(new Error("Request failed"), { status: 404 });

    expect(resolveMissingCalendarFailure(notFound)?.slug).toBe("provider-calendar-not-found");
  });
});
