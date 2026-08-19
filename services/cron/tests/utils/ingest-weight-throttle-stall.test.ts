import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "@keeper.sh/calendar";
import {
  WEIGHT_BUDGET,
  WEIGHT_FLOOR,
} from "../../src/utils/ingest-weight";

/*
 * A source holding the whole budget pins
 * the whole shared budget while merely sleeping in a provider rate limiter.
 * One flush writer serves the OAuth, CalDAV, and ICS families, so a tiny warm
 * reservation from another family must still be admitted through that.
 */

const OTHER_FAMILY_WAIT_MS = 200;

describe("shared flush budget under cold-start provider throttling", () => {
  it("admits a small warm reservation while cold fetches sleep in a rate limiter", async () => {
    const flushed: number[] = [];
    const worker = createSerialFlushWorker(
      (task: () => Promise<number>) => task(),
      { budget: WEIGHT_BUDGET, capacity: 50 },
    );

    const coldReservation = await worker.reserve(WEIGHT_BUDGET);

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

    coldReservation.release();
    const settledWarm = await warmReservation;
    flushed.push(await settledWarm.submit(() => Promise.resolve(1)));
    expect(flushed).toEqual([1]);
    await worker.close();
  });
});
