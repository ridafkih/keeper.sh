import { describe, expect, it } from "vitest";
import { closeDatabase, createDatabase } from "../../src/index";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

/*
 * The cron shutdown path bounds the flush drain at 2s precisely so a wedged
 * flush cannot keep the process alive until the supervisor SIGKILLs it
 * (services/cron/src/context.ts). After that deadline it calls
 * closeDatabase(flushDatabase, { graceSeconds }). Bun's SQL close() with no
 * options awaits every in-flight query before closing the pool, so if the
 * wedged query is still running, pool teardown inherits the very unbounded
 * wait the drain deadline was added to remove. This pins the requirement that
 * closeDatabase with an explicit grace settles the pool within the shutdown
 * bound even with a query still in flight. The unbounded default is pinned
 * separately by close-database-api-shutdown.test.ts.
 */
const WEDGED_QUERY_SECONDS = 8;
const SHUTDOWN_BOUND_MS = 3000;
const CLOSE_GRACE_SECONDS = 2;

describe.skipIf(!TEST_DATABASE_URL)("closeDatabase with a wedged in-flight query", () => {
  it("settles pool teardown within the shutdown bound", async () => {
    const database = await createDatabase(TEST_DATABASE_URL as string, {
      maxConnections: 1,
      statementTimeoutMs: 60_000,
    });

    // Capture the promise closeDatabase discards so the teardown is observable.
    const client = database.$client;
    const originalClose = client.close.bind(client);
    let capturedClose: Promise<unknown> | null = null;
    (client as { close: typeof client.close }).close = ((options?: { timeout?: number }) => {
      capturedClose = originalClose(options);
      return capturedClose;
    }) as typeof client.close;

    // A flush wedged mid-statement on the dedicated single connection.
    const wedged = database
      .execute(`select pg_sleep(${WEDGED_QUERY_SECONDS})`)
      .then(
        () => "completed",
        () => "aborted",
      );
    // Give the statement time to reach the server before shutdown begins.
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });

    const closeStartedAt = Date.now();
    closeDatabase(database, { graceSeconds: CLOSE_GRACE_SECONDS });
    expect(capturedClose).not.toBeNull();

    let boundTimer: ReturnType<typeof setTimeout> | null = null;
    const bound = new Promise<string>((resolve) => {
      boundTimer = setTimeout(() => {
        resolve("still-open");
      }, SHUTDOWN_BOUND_MS);
    });
    const outcome = await Promise.race([
      (capturedClose as unknown as Promise<unknown>).then(
        () => "closed",
        () => "closed",
      ),
      bound,
    ]);
    if (boundTimer !== null) {
      clearTimeout(boundTimer);
    }
    const elapsedMs = Date.now() - closeStartedAt;

    // Let the wedged query finish so the suite exits cleanly either way.
    await wedged;
    await (capturedClose as unknown as Promise<unknown>).catch(() => null);

    expect(outcome, `pool still open ${elapsedMs}ms after closeDatabase`).toBe("closed");
  }, 30_000);
});
