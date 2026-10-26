import { describe, expect, it } from "vitest";
import {
  BASELINE_MOVED_RETRY_MS,
  CREDENTIAL_PROBE_MS,
  DEFAULT_INGEST_INTERVAL_DIALS,
  LOCK_HELD_RETRY_MS,
  UNBACKED_FAILURE_RETRY_MS,
  UNRESOLVABLE_PROBE_MS,
  resolveIngestIntervalMs,
  resolveIngestJitterMs,
  resolveIngestScheduleDecision,
  resolveWakeDebounceMs,
} from "../../../src/core/source/ingest-schedule-policy";
import type { IngestOutcome } from "../../../src/core/source/ingest-schedule-policy";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const decide = (outcome: IngestOutcome, failureCount = 0) =>
  resolveIngestScheduleDecision(outcome, {
    failureCount,
    intervalMs: 10 * MINUTE_MS,
    jitterMs: 30_000,
  });

describe("resolveIngestIntervalMs", () => {
  it("polls pro calendars every minute and free calendars every ten minutes", () => {
    expect(resolveIngestIntervalMs({ dormant: false, plan: "pro", pushHealthy: false }))
      .toBe(MINUTE_MS);
    expect(resolveIngestIntervalMs({ dormant: false, plan: "free", pushHealthy: false }))
      .toBe(10 * MINUTE_MS);
  });

  it("falls back to a safety poll when push notifications are healthy", () => {
    expect(resolveIngestIntervalMs({ dormant: false, plan: "pro", pushHealthy: true }))
      .toBe(5 * MINUTE_MS);
    expect(resolveIngestIntervalMs({ dormant: false, plan: "free", pushHealthy: true }))
      .toBe(HOUR_MS);
  });

  it("stretches a dormant calendar to the dormant interval whatever else holds", () => {
    for (const plan of ["free", "pro"] as const) {
      for (const pushHealthy of [false, true]) {
        expect(resolveIngestIntervalMs({ dormant: true, plan, pushHealthy })).toBe(24 * HOUR_MS);
      }
    }
  });

  it("never shortens an interval for dormancy", () => {
    const dials = { ...DEFAULT_INGEST_INTERVAL_DIALS, dormantMs: MINUTE_MS };
    expect(resolveIngestIntervalMs({ dormant: true, plan: "free", pushHealthy: true }, dials))
      .toBe(HOUR_MS);
  });

  it("reads every interval from the dials", () => {
    const dials = {
      dormantMs: 7,
      freePollMs: 3,
      freeSafetyMs: 4,
      proPollMs: 1,
      proSafetyMs: 2,
    };
    expect(resolveIngestIntervalMs({ dormant: false, plan: "pro", pushHealthy: false }, dials)).toBe(1);
    expect(resolveIngestIntervalMs({ dormant: false, plan: "pro", pushHealthy: true }, dials)).toBe(2);
    expect(resolveIngestIntervalMs({ dormant: false, plan: "free", pushHealthy: false }, dials)).toBe(3);
    expect(resolveIngestIntervalMs({ dormant: false, plan: "free", pushHealthy: true }, dials)).toBe(4);
    expect(resolveIngestIntervalMs({ dormant: true, plan: "free", pushHealthy: false }, dials)).toBe(7);
  });
});

describe("resolveIngestJitterMs", () => {
  it("stays within a tenth of the interval", () => {
    expect(resolveIngestJitterMs(10 * MINUTE_MS, () => 0)).toBe(0);
    expect(resolveIngestJitterMs(10 * MINUTE_MS, () => 0.999_999)).toBeLessThan(MINUTE_MS);
  });

  it("never exceeds two minutes for long intervals", () => {
    expect(resolveIngestJitterMs(24 * HOUR_MS, () => 0.999_999)).toBeLessThan(2 * MINUTE_MS);
  });
});

describe("resolveWakeDebounceMs", () => {
  it("reads pro notifications at once and folds free notifications for five minutes", () => {
    expect(resolveWakeDebounceMs("pro")).toBe(0);
    expect(resolveWakeDebounceMs("free")).toBe(5 * MINUTE_MS);
  });
});

describe("resolveIngestScheduleDecision", () => {
  it("schedules a successful read inside the interval and clears failures", () => {
    expect(decide({ kind: "ingested" }, 4)).toEqual({
      attempted: true,
      failed: false,
      failureCount: 0,
      nextDueInMs: 10 * MINUTE_MS - 30_000,
      parkedReason: null,
      succeeded: true,
    });
  });

  it("retries soon without counting a failure when another reader holds the calendar", () => {
    expect(decide({ kind: "lock-held" }, 2)).toMatchObject({
      attempted: false,
      failureCount: 2,
      nextDueInMs: LOCK_HELD_RETRY_MS,
    });
    expect(decide({ kind: "baseline-moved" }, 2)).toMatchObject({
      attempted: false,
      failureCount: 2,
      nextDueInMs: BASELINE_MOVED_RETRY_MS,
    });
  });

  it("backs off transient failures exponentially up to six hours", () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 7, 20].map((failureCount) =>
      decide({ backoff: true, kind: "failed" }, failureCount).nextDueInMs);
    expect(delays.slice(0, 4)).toEqual([5, 10, 20, 40].map((minutes) => minutes * MINUTE_MS));
    expect(delays.at(-1)).toBe(6 * HOUR_MS);
    expect(decide({ backoff: true, kind: "failed" }, 3).failureCount).toBe(4);
  });

  it("retries an infrastructure failure after a minute without escalating backoff", () => {
    expect(decide({ backoff: false, kind: "failed" }, 3)).toMatchObject({
      failed: true,
      failureCount: 3,
      nextDueInMs: UNBACKED_FAILURE_RETRY_MS,
    });
  });

  it("backs off a calendar the provider refuses to read", () => {
    expect(decide({ kind: "request-rejected" }, 1)).toMatchObject({
      failureCount: 2,
      nextDueInMs: 10 * MINUTE_MS,
      parkedReason: null,
    });
  });

  it("parks a rejected credential behind a daily probe", () => {
    expect(decide({ kind: "credential-rejected" }, 0)).toMatchObject({
      attempted: true,
      failed: true,
      nextDueInMs: CREDENTIAL_PROBE_MS,
      parkedReason: "credential-rejected",
    });
  });

  it("parks a calendar that cannot be resolved behind an hourly probe", () => {
    expect(decide({ kind: "unresolvable" }, 0)).toMatchObject({
      attempted: true,
      failed: false,
      nextDueInMs: UNRESOLVABLE_PROBE_MS,
      parkedReason: "unresolvable",
    });
  });

  it("never schedules a read in the past", () => {
    expect(resolveIngestScheduleDecision({ kind: "ingested" }, {
      failureCount: 0,
      intervalMs: 1000,
      jitterMs: 5000,
    }).nextDueInMs).toBe(0);
  });
});
