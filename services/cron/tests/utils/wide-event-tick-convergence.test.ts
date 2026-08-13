import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withCronWideEvent } from "../../src/utils/with-wide-event";

interface EmittedEvent {
  db?: { error_sqlstate?: string };
  error?: { slug?: string };
  outcome?: string;
}

const emitted: EmittedEvent[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

const captureLine = (chunk: unknown): void => {
  const text = String(chunk);
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    emitted.push(JSON.parse(line) as EmittedEvent);
  }
};

beforeEach(() => {
  emitted.length = 0;
  process.stdout.write = ((chunk: unknown) => {
    captureLine(chunk);
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const terminatedByAdministrator = (): DrizzleQueryError =>
  new DrizzleQueryError(
    "select \"id\" from \"calendar_sources\"",
    [],
    postgresError("terminating connection due to administrator command", {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "57P01",
    }),
  );

const runTick = async (failWith: unknown): Promise<void> => {
  const job = withCronWideEvent({
    callback: async () => {
      await Bun.sleep(0);
      if (failWith !== null) {
        throw failWith;
      }
    },
    cron: "@every_1_minutes",
    name: "ingest-sources",
  });
  const tick = job.callback as () => Promise<void>;
  if (failWith === null) {
    await tick();
    return;
  }
  await expect(tick()).rejects.toThrow();
};

describe("cron wide event across repeated ticks", () => {
  it("emits the same database slug and SQLSTATE on every tick of a sustained outage", async () => {
    await runTick(terminatedByAdministrator());
    await runTick(terminatedByAdministrator());
    await runTick(terminatedByAdministrator());

    expect(emitted).toHaveLength(3);
    expect(emitted.map((event) => event.error?.slug)).toEqual([
      "db-connection-unavailable",
      "db-connection-unavailable",
      "db-connection-unavailable",
    ]);
    expect(emitted.map((event) => event.db?.error_sqlstate)).toEqual([
      "57P01",
      "57P01",
      "57P01",
    ]);
  });

  it("clears the database SQLSTATE once the pool recovers", async () => {
    await runTick(terminatedByAdministrator());
    await runTick(null);
    await runTick(new Error("provider returned 500"));

    expect(emitted.map((event) => event.outcome)).toEqual(["error", "success", "error"]);
    expect(emitted[1]?.db?.error_sqlstate).toBeUndefined();
    expect(emitted[2]?.db?.error_sqlstate).toBeUndefined();
    expect(emitted[2]?.error?.slug).toBe("unclassified");
  });

  it("classifies concurrently running jobs independently", async () => {
    const databaseTick = runTick(terminatedByAdministrator());
    const providerTick = runTick(new Error("provider returned 500"));
    await Promise.all([databaseTick, providerTick]);

    const slugs = emitted.map((event) => event.error?.slug).toSorted();
    expect(slugs).toEqual(["db-connection-unavailable", "unclassified"]);
    const databaseEvent = emitted.find(
      (event) => event.error?.slug === "db-connection-unavailable",
    );
    const providerEvent = emitted.find((event) => event.error?.slug === "unclassified");
    expect(databaseEvent?.db?.error_sqlstate).toBe("57P01");
    expect(providerEvent?.db?.error_sqlstate).toBeUndefined();
  });
});
