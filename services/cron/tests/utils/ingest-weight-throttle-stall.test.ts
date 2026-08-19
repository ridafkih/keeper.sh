import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "@keeper.sh/calendar";
import {
  NEVER_INGESTED_WEIGHT,
  WEIGHT_BUDGET,
  WEIGHT_FLOOR,
} from "../../src/utils/ingest-weight";

/*
 * Reserve-before-fetch holds a source's flush weight across its ENTIRE
 * provider fetch, including signal-bound waits inside it (the google per-user
 * limiter's waitForRetry loop, slow or hung provider responses up to the 120s
 * deadline). NEVER_INGESTED_WEIGHT is WEIGHT_BUDGET / 8, so eight
 * concurrently launched first-ingest sources — 4 distinct users at
 * taskConcurrency 2 — pin 100% of the budget while doing nothing but
 * sleeping in a rate limiter. Because one module-level flush writer is
 * shared by the OAuth, CalDAV, and ICS families, every other source
 * fleet-wide then parks in reserve()'s FIFO.
 *
 * This test reproduces that composition with the production constants and
 * asserts the desired property: a tiny warm-source reservation from another
 * family must still be admitted while cold-start fetches are merely waiting
 * on their providers. On current code it is not — the budget is fully
 * pinned — so this test FAILS, proving the stall.
 */

const COLD_START_SOURCES = 8;
const OTHER_FAMILY_WAIT_MS = 200;

describe("shared flush budget under cold-start provider throttling", () => {
  it("admits a small warm reservation while cold fetches sleep in a rate limiter", async () => {
    const flushed: number[] = [];
    const worker = createSerialFlushWorker(
      (task: () => Promise<number>) => task(),
      { budget: WEIGHT_BUDGET, capacity: 50 },
    );

    /*
     * Eight cold-start sources reserve budget/8 each, exactly as
     * reserveIngestFlushWeight sizes a never-ingested calendar, then enter
     * their provider fetch and park in the per-user limiter's retry wait.
     */
    const coldReservations = await Promise.all(
      Array.from({ length: COLD_START_SOURCES }, () =>
        worker.reserve(NEVER_INGESTED_WEIGHT)),
    );
    // The budget is now fully committed: 8 * (WEIGHT_BUDGET / 8).
    expect(COLD_START_SOURCES * NEVER_INGESTED_WEIGHT).toBe(WEIGHT_BUDGET);

    /*
     * A warm ICS source from a different provider family now needs only the
     * floor weight (16KB of a 64MB budget). Its provider is healthy; nothing
     * about it is throttled. It must not stall behind sleeping cold fetches.
     */
    let warmAdmitted = false;
    const warmReservation = worker
      .reserve(WEIGHT_FLOOR)
      .then((reservation) => {
        warmAdmitted = true;
        return reservation;
      });

    // Give the worker ample real time to admit the 16KB reservation.
    await new Promise((resolve) => {
      setTimeout(resolve, OTHER_FAMILY_WAIT_MS);
    });

    /*
     * Desired behavior: throttle waits inside one family's provider fetches
     * must not pin the shared budget against every other family. Current
     * code holds all eight cold weights through the sleep, so this expect
     * fails with warmAdmitted === false.
     */
    expect(warmAdmitted).toBe(true);

    // Cleanup: the cold fetches "return" and release, letting things drain.
    for (const reservation of coldReservations) {
      reservation.release();
    }
    const settledWarm = await warmReservation;
    flushed.push(await settledWarm.submit(() => Promise.resolve(1)));
    expect(flushed).toEqual([1]);
    await worker.close();
  });
});
