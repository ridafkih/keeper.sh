import { createSerialFlushWorker } from "@keeper.sh/calendar";
import { closeDatabase, createDatabase, resolveDatabaseErrorClassification } from "@keeper.sh/database";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { requiresReauthentication } from "../../src/utils/error-flags";

/*
 * Shutdown's drain deadline (services/cron/src/context.ts) races
 * drainFlushWriters() against FLUSH_DRAIN_DEADLINE_MS and, when the drain
 * loses, closes the flush database with a bounded grace. That force-close
 * kills the still-running flush connection, so the flush rejects with a Bun
 * connection error (db-connection-terminated / db-connection-unavailable).
 * That failure is keeper's own shutdown infrastructure — the calendar's
 * provider was never at fault — so it must carry the same provider-backoff
 * exemption as every other shutdown rejection (SerialFlushWorkerClosedError,
 * the redis-teardown message, reserve-park aborts). This reproduces the exact
 * shutdown sequence and pins that exemption via requiresReauthentication, the
 * gate shouldApplyOAuthIngestBackoff negates in ingest-sources.ts.
 */

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

// Mirrors FLUSH_DRAIN_DEADLINE_MS and CLOSE_GRACE_SECONDS in services/cron/src/context.ts.
const FLUSH_DRAIN_DEADLINE_MS = 2000;
const CLOSE_GRACE_SECONDS = 2;
// Long enough that the flush is still mid-statement when the grace expires.
const WEDGED_FLUSH_SECONDS = 10;
const FLUSH_BUDGET = 1000;
const FLUSH_CAPACITY = 50;
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

      // An in-flight flush transaction, exactly as ingest submits one at SIGTERM.
      const reservation = await worker.reserve(1);
      const flush = reservation.submit(async () =>
        await flushDatabase.transaction(async (transaction) => {
          await transaction.execute(sql`select pg_sleep(${WEDGED_FLUSH_SECONDS})`);
        }));
      const observedError = flush.then(
        () => null,
        (error: unknown) => error,
      );
      // Give the statement time to reach the server before shutdown begins.
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });

      // The shutdownDatabases sequence from services/cron/src/context.ts.
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
      // The drain lost the race: the flush is still in flight when close begins.
      expect(raceOutcome).toBe("deadline");
      closeDatabase(flushDatabase, { graceSeconds: CLOSE_GRACE_SECONDS });

      const error = await observedError;
      // Let the pump settle so the suite exits cleanly.
      await drain;

      // The force-close killed the flush with a connection-class database error.
      expect(error).not.toBeNull();
      expect(resolveDatabaseErrorClassification(error)?.slug).toBeOneOf(CONNECTION_SLUGS);
      /*
       * The failure came from keeper's own shutdown, never the provider, so it
       * must pass the exemption gate: requiresReauthentication(error) is what
       * shouldApplyOAuthIngestBackoff negates before applyIngestBackoff runs.
       */
      expect(requiresReauthentication(error)).toBe(true);
    }, 30_000);
  },
);
