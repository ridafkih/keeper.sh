import { describe, expect, it } from "vitest";
import { closeDatabase, createDatabase } from "../../src/index";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

/*
 * Bun's SQL close() with no options awaits every in-flight query, so pool
 * teardown would inherit the very unbounded wait cron's drain deadline exists
 * to remove. An explicit grace must settle the pool within the shutdown bound.
 * The unbounded default is pinned by close-database-api-shutdown.test.ts.
 */
const WEDGED_QUERY_SECONDS = 8;
const SHUTDOWN_BOUND_MS = 3000;
const CLOSE_GRACE_SECONDS = 2;
const STATEMENT_REACHES_SERVER_MS = 300;

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

    const wedged = database
      .execute(`select pg_sleep(${WEDGED_QUERY_SECONDS})`)
      .then(
        () => "completed",
        () => "aborted",
      );
    await new Promise((resolve) => {
      setTimeout(resolve, STATEMENT_REACHES_SERVER_MS);
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

    /* Let the wedged query finish so the suite exits cleanly either way. */
    await wedged;
    await (capturedClose as unknown as Promise<unknown>).catch(() => null);

    expect(outcome, `pool still open ${elapsedMs}ms after closeDatabase`).toBe("closed");
  }, 30_000);
});
