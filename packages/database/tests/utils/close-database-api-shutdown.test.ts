import { describe, expect, it } from "vitest";
import { closeDatabase, createDatabase } from "../../src/index";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

/*
 * The API stops its server and closes the database with no request drain in
 * between, so an in-flight write-back races pool teardown. Such a write-back
 * can run minutes-scale — far past any short grace, but well inside the pool's
 * own statement_timeout — and must still be allowed to finish.
 */
const HEALTHY_STATEMENT_SECONDS = 2;
const STATEMENT_TIMEOUT_MS = 30_000;
const STATEMENT_REACHES_SERVER_MS = 300;

describe.skipIf(!TEST_DATABASE_URL)("closeDatabase during API shutdown", () => {
  it("lets a healthy in-flight write-back transaction finish", async () => {
    const database = await createDatabase(TEST_DATABASE_URL as string, {
      maxConnections: 2,
      statementTimeoutMs: STATEMENT_TIMEOUT_MS,
    });

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

    await new Promise((resolve) => {
      setTimeout(resolve, STATEMENT_REACHES_SERVER_MS);
    });

    closeDatabase(database);

    expect(await writeBack).toBe("committed");
  }, 30_000);
});
