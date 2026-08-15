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
    count: () => null,
    max: () => null,
    min: () => null,
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

describe("a cron job whose own queries fail because the pool is unreachable", () => {
  beforeEach(() => {
    emitted.length = 0;
    current = { fields: {}, values: {} };
  });

  it("labels a pooled connection closed under the source listing as a database failure", async () => {
    await runJob(sourceListingQuery(
      postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" }),
    ));

    expect(lastEvent().fields.slug).toBe("db-connection-unavailable");
  });

  it("labels the aggregate the ingest job actually throws as a database failure", async () => {
    const aggregate = new AggregateError(
      [
        sourceListingQuery(postgresError("Connection closed", {
          code: "ERR_POSTGRES_CONNECTION_CLOSED",
        })),
        sourceListingQuery(postgresError("Connection closed", {
          code: "ERR_POSTGRES_CONNECTION_CLOSED",
        })),
        sourceListingQuery(postgresError("Connection closed", {
          code: "ERR_POSTGRES_CONNECTION_CLOSED",
        })),
      ],
      "Calendar source ingestion completed with failures",
    );

    await runJob(aggregate);

    expect(lastEvent().fields.slug).toBe("db-connection-unavailable");
  });

  it("records the SQLSTATE when the server terminates the job's connections", async () => {
    await runJob(sourceListingQuery(
      postgresError("terminating connection due to administrator command", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "57P01",
      }),
    ));

    expect(lastEvent().values["db.error_sqlstate"]).toBe("57P01");
  });

  it("labels a role connection limit as a database failure rather than leaving it unlabelled", async () => {
    await runJob(sourceListingQuery(
      postgresError("too many connections for role \"keeper_app\"", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "53300",
      }),
    ));

    expect(lastEvent().fields.slug).toBe("db-connection-unavailable");
  });

  it("keeps labelling repeated ticks of one outage the same way", async () => {
    for (let tick = 0; tick < 3; tick++) {
      await runJob(sourceListingQuery(
        postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" }),
      ));
    }

    expect(emitted.map((event) => event.fields.slug)).toEqual([
      "db-connection-unavailable",
      "db-connection-unavailable",
      "db-connection-unavailable",
    ]);
  });

  it("still leaves a failure that did not come from the database unlabelled", async () => {
    await runJob(new Error("redis: connection refused"));

    expect(lastEvent().fields.slug).toBe("unclassified");
  });

  it("marks the outcome as an error whatever the failure was", async () => {
    await runJob(sourceListingQuery(
      postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" }),
    ));

    expect(lastEvent().values.outcome).toBe("error");
  });
});
