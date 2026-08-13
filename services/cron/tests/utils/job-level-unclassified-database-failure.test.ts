import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emitted: { fields: Record<string, unknown>; values: Record<string, unknown> }[] = [];
let current: { fields: Record<string, unknown>; values: Record<string, unknown> } = {
  fields: {},
  values: {},
};

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<void>) => await run(),
  widelog: {
    error: () => null,
    errorFields: (_error: unknown, fields: Record<string, unknown>) => {
      current.fields = { ...current.fields, ...fields };
    },
    flush: () => {
      emitted.push(current);
      current = { fields: {}, values: {} };
    },
    set: (key: string, value: unknown) => {
      current.values[key] = value;
    },
    time: {
      measure: async (_key: string, run: () => Promise<void>) => await run(),
    },
  },
}));

const { withCronWideEvent } = await import("../../src/utils/with-wide-event");

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const sourceListingQuery = (cause: Error): DrizzleQueryError =>
  new DrizzleQueryError(
    "select \"id\", \"user_id\" from \"calendars\" inner join \"calendar_accounts\" on true",
    [],
    cause,
  );

const rejectWith = async (error: unknown): Promise<void> => {
  await Bun.sleep(0);
  throw error;
};

const runJob = async (error: unknown): Promise<void> => {
  const job = withCronWideEvent({
    callback: () => rejectWith(error),
    cron: "@every_1_minutes",
    name: "ingest-sources",
  });
  await expect((job.callback as () => Promise<void>)()).rejects.toThrow();
};

const lastEvent = () => {
  const event = emitted.at(-1);
  if (!event) {
    throw new Error("expected the job wrapper to flush a wide event");
  }
  return event;
};

describe("a cron job whose own queries fail for a reason the pool classifier does not name", () => {
  beforeEach(() => {
    emitted.length = 0;
    current = { fields: {}, values: {} };
  });

  it.each([
    ["a deadlock", "40P01", "deadlock detected"],
    ["a unique violation", "23505", "duplicate key value violates unique constraint"],
    ["a serialization failure", "40001", "could not serialize access due to concurrent update"],
  ])("labels %s as a database failure rather than leaving it unlabelled", async (
    _label,
    errno,
    message,
  ) => {
    await runJob(sourceListingQuery(
      postgresError(message, { code: "ERR_POSTGRES_SERVER_ERROR", errno }),
    ));

    expect(lastEvent().fields.slug).toBe("db-query-failed");
    expect(lastEvent().values["db.error_sqlstate"]).toBe(errno);
  });

  it("still leaves a failure that did not come from the database unlabelled", async () => {
    await runJob(new Error("redis: connection refused"));

    expect(lastEvent().fields.slug).toBe("unclassified");
  });
});
