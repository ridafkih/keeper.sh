import { describe, expect, it } from "vitest";
import { DEFAULT_INGEST_INTERVAL_DIALS } from "@keeper.sh/calendar";
import { INGEST_SOURCE_TIMEOUT_MS } from "@keeper.sh/constants";
import { resolveIngestDials } from "../../src/ingest/ingest-dials";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("resolveIngestDials", () => {
  it("defaults every dial when nothing is set", () => {
    expect(resolveIngestDials({})).toEqual({
      dormantAfterMs: 30 * DAY_MS,
      fleet: { batchSize: 50, capacity: 64, idleMs: 2000 },
      intervals: DEFAULT_INGEST_INTERVAL_DIALS,
      leaseMs: 2 * INGEST_SOURCE_TIMEOUT_MS,
      loopEnabled: true,
      providerRequestsPerMinute: { google: null, outlook: null },
      wake: { batchSize: 50, capacity: 16, idleMs: 1000 },
    });
  });

  it("reads intervals in seconds", () => {
    const dials = resolveIngestDials({
      INGEST_DORMANT_POLL_SECONDS: 3600,
      INGEST_FREE_POLL_SECONDS: 1800,
      INGEST_FREE_SAFETY_POLL_SECONDS: 7200,
      INGEST_PRO_POLL_SECONDS: 30,
      INGEST_PRO_SAFETY_POLL_SECONDS: 600,
    });

    expect(dials.intervals).toEqual({
      dormantMs: 3_600_000,
      freePollMs: 1_800_000,
      freeSafetyMs: 7_200_000,
      proPollMs: 30_000,
      proSafetyMs: 600_000,
    });
  });

  it("sizes each lane from its own concurrency and a shared batch", () => {
    const dials = resolveIngestDials({
      INGEST_CLAIM_BATCH: 10,
      INGEST_FLEET_CONCURRENCY: 200,
      INGEST_FLEET_IDLE_MS: 5000,
      INGEST_WAKE_CONCURRENCY: 4,
      INGEST_WAKE_IDLE_MS: 250,
    });

    expect(dials.fleet).toEqual({ batchSize: 10, capacity: 200, idleMs: 5000 });
    expect(dials.wake).toEqual({ batchSize: 10, capacity: 4, idleMs: 250 });
  });

  it("falls back to the default for zero, negative or non-finite values", () => {
    const dials = resolveIngestDials({
      INGEST_CLAIM_BATCH: 0,
      INGEST_FLEET_CONCURRENCY: -5,
      INGEST_FREE_POLL_SECONDS: Number.NaN,
      INGEST_LEASE_SECONDS: Number.POSITIVE_INFINITY,
    });

    expect(dials.fleet.batchSize).toBe(50);
    expect(dials.fleet.capacity).toBe(64);
    expect(dials.intervals.freePollMs).toBe(DEFAULT_INGEST_INTERVAL_DIALS.freePollMs);
    expect(dials.leaseMs).toBe(2 * INGEST_SOURCE_TIMEOUT_MS);
  });

  it("turns dormancy off when the threshold is zero days", () => {
    expect(resolveIngestDials({ INGEST_DORMANT_AFTER_DAYS: 0 }).dormantAfterMs).toBeNull();
    expect(resolveIngestDials({ INGEST_DORMANT_AFTER_DAYS: 7 }).dormantAfterMs).toBe(7 * DAY_MS);
  });

  it("only turns the loop off when asked to", () => {
    expect(resolveIngestDials({ INGEST_LOOP_ENABLED: false }).loopEnabled).toBe(false);
    expect(resolveIngestDials({ INGEST_LOOP_ENABLED: true }).loopEnabled).toBe(true);
  });

  it("enables a provider-wide limit only for a positive rate", () => {
    const dials = resolveIngestDials({
      GOOGLE_INGEST_REQUESTS_PER_MINUTE: 6000,
      OUTLOOK_INGEST_REQUESTS_PER_MINUTE: 0,
    });

    expect(dials.providerRequestsPerMinute).toEqual({ google: 6000, outlook: null });
  });
});
