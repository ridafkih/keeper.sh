import { createSerialFlushWorker } from "@keeper.sh/calendar";
import { closeDatabase, createDatabase, resolveDatabaseErrorClassification } from "@keeper.sh/database";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { requiresReauthentication } from "../../src/utils/error-flags";

/*
 * When the drain loses its race, the force-close kills the running flush
 * connection and the flush rejects with a Bun connection error. That is
 * keeper's own shutdown, never the provider, so it must carry the same
 * backoff exemption as every other shutdown rejection.
 */

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

/* Mirrors FLUSH_DRAIN_DEADLINE_MS and CLOSE_GRACE_SECONDS in src/context.ts. */
const FLUSH_DRAIN_DEADLINE_MS = 2000;
const CLOSE_GRACE_SECONDS = 2;
/* Long enough that the flush is still mid-statement when the grace expires. */
const WEDGED_FLUSH_SECONDS = 10;
const FLUSH_BUDGET = 1000;
const FLUSH_CAPACITY = 50;
const STATEMENT_REACHES_SERVER_MS = 300;
const CONNECTION_SLUGS = ["db-connection-terminated", "db-connection-unavailable"];

describe.skipIf(!TEST_DATABASE_URL)(
  "drain-deadline force-close versus provider ingest backoff",
  () => {
    it("exempts a flush killed by the shutdown force-close from provider backoff", async () => {
      const flushDatabase = await createDatabase(TEST_DATABASE_URL as string, {
        maxConnections: 1,
      });
      const worker = createSerialFlushWorker(
        (task: () => Promise<unknown>) => task(),
        { budget: FLUSH_BUDGET, capacity: FLUSH_CAPACITY },
      );

      const reservation = await worker.reserve(1);
      const flush = reservation.submit(async () =>
        await flushDatabase.transaction(async (transaction) => {
          await transaction.execute(sql`select pg_sleep(${WEDGED_FLUSH_SECONDS})`);
        }));
      const observedError = flush.then(
        () => null,
        (error: unknown) => error,
      );
      await new Promise((resolve) => {
        setTimeout(resolve, STATEMENT_REACHES_SERVER_MS);
      });

      /* The shutdownDatabases sequence from src/context.ts. */
      const drain = worker.close().then(
        () => "drained",
        () => "drain-failed",
      );
      let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
      const deadline = new Promise<string>((resolve) => {
        deadlineTimer = setTimeout(() => {
          resolve("deadline");
        }, FLUSH_DRAIN_DEADLINE_MS);
      });
      const raceOutcome = await Promise.race([drain, deadline]);
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
      }
      expect(raceOutcome).toBe("deadline");
      closeDatabase(flushDatabase, { graceSeconds: CLOSE_GRACE_SECONDS });

      const error = await observedError;
      await drain;

      expect(error).not.toBeNull();
      expect(resolveDatabaseErrorClassification(error)?.slug).toBeOneOf(CONNECTION_SLUGS);
      expect(requiresReauthentication(error)).toBe(true);
    }, 30_000);
  },
);
