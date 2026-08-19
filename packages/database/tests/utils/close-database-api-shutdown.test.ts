import { describe, expect, it } from "vitest";
import { closeDatabase, createDatabase } from "../../src/index";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

/*
 * The API shutdown path (services/api/src/index.ts) runs
 * `server.stop(); closeDatabase(database);` with no request drain in between,
 * so any in-flight request's database work races pool teardown directly. The
 * previous unbounded close() awaited every in-flight statement — and even let
 * an open transaction issue further statements until it committed — so a
 * healthy request finished its write-back across a deploy's SIGTERM. The
 * caldav persist write-back the API runs in-request holds its advisory lock
 * minutes-scale (services/cron/src/jobs/ingest-sources.ts), far past any
 * two-second grace, while staying well inside the 30s statement_timeout the
 * pool itself configures. This pins the graceful half of shutdown: a healthy
 * in-flight transaction, comfortably under every configured statement bound,
 * must be allowed to finish when closeDatabase is called at API shutdown.
 */
const HEALTHY_STATEMENT_SECONDS = 2;
const STATEMENT_TIMEOUT_MS = 30_000;

describe.skipIf(!TEST_DATABASE_URL)("closeDatabase during API shutdown", () => {
  it("lets a healthy in-flight write-back transaction finish", async () => {
    const database = await createDatabase(TEST_DATABASE_URL as string, {
      maxConnections: 2,
      statementTimeoutMs: STATEMENT_TIMEOUT_MS,
    });

    /*
     * A request-scoped write-back: an open transaction doing healthy,
     * statement_timeout-respecting work when SIGTERM lands.
     */
    const writeBack = database
      .transaction(async (transaction) => {
        await transaction.execute(`select pg_sleep(${HEALTHY_STATEMENT_SECONDS})`);
        await transaction.execute(`select pg_sleep(${HEALTHY_STATEMENT_SECONDS})`);
        return "committed";
      })
      .then(
        (outcome) => outcome,
        () => "rolled-back",
      );

    /*
     * Give the first statement time to reach the server, as it would have at
     * the moment a deploy's SIGTERM arrives mid-request.
     */
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });

    /*
     * The API cleanup calls closeDatabase immediately after server.stop(),
     * without draining in-flight requests.
     */
    closeDatabase(database);

    expect(await writeBack).toBe("committed");
  }, 30_000);
});
