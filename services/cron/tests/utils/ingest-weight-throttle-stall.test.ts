import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "@keeper.sh/calendar";
import {
  NEVER_INGESTED_WEIGHT,
  WEIGHT_BUDGET,
  WEIGHT_FLOOR,
} from "../../src/utils/ingest-weight";

/*
 * NEVER_INGESTED_WEIGHT is WEIGHT_BUDGET / 8, so eight cold-start sources pin
 * the whole shared budget while merely sleeping in a provider rate limiter.
 * One flush writer serves the OAuth, CalDAV, and ICS families, so a tiny warm
 * reservation from another family must still be admitted through that.
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

    const coldReservations = await Promise.all(
      Array.from({ length: COLD_START_SOURCES }, () =>
        worker.reserve(NEVER_INGESTED_WEIGHT)),
    );
    expect(COLD_START_SOURCES * NEVER_INGESTED_WEIGHT).toBe(WEIGHT_BUDGET);

    /* A healthy warm source of another family needs only the floor: 16KB of 64MB. */
    let warmAdmitted = false;
    const warmReservation = worker
      .reserve(WEIGHT_FLOOR)
      .then((reservation) => {
        warmAdmitted = true;
        return reservation;
      });

    await new Promise((resolve) => {
      setTimeout(resolve, OTHER_FAMILY_WAIT_MS);
    });

    expect(warmAdmitted).toBe(true);

    for (const reservation of coldReservations) {
      reservation.release();
    }
    const settledWarm = await warmReservation;
    flushed.push(await settledWarm.submit(() => Promise.resolve(1)));
    expect(flushed).toEqual([1]);
    await worker.close();
  });
});
