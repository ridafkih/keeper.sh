import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createSerialFlushWorker,
  resolveCalendarBackoffDelayMs,
  resolveIngestScheduleDecision,
} from "@keeper.sh/calendar";
import { CalendarFetchError } from "@keeper.sh/calendar/ics";
import { ResponseTooLargeError } from "@keeper.sh/calendar/safe-fetch";
import {
  WEIGHT_BUDGET,
} from "../../src/utils/ingest-weight";
import { OperationTimeoutError, withAbortTimeout } from "../../src/utils/with-abort-timeout";
import { isIngestInfrastructureError } from "../../src/utils/error-flags";
import {
  resolveMissingCalendarFailure,
  shouldTreatAsProviderAuthFailure,
} from "../../src/utils/provider-ingest-failure";

const shouldApplyCalDavIngestBackoff = (error: unknown): boolean =>
  !shouldTreatAsProviderAuthFailure(error) && !isIngestInfrastructureError(error);

const shouldApplyIcsIngestBackoff = (error: unknown): boolean =>
  !isIngestInfrastructureError(error);

const SHORT_DEADLINE_MS = 50;

const produceBudgetStarvationTimeout = async (): Promise<unknown> => {
  const worker = createSerialFlushWorker(
    (task: () => Promise<number>) => task(),
    { budget: WEIGHT_BUDGET, capacity: 50 },
  );
  const hold = await worker.reserve(WEIGHT_BUDGET);
  let caught: unknown = null;
  try {
    await withAbortTimeout(
      (signal) => worker.reserve(WEIGHT_BUDGET, signal),
      SHORT_DEADLINE_MS,
    );
  } catch (error) {
    caught = error;
  }
  hold.release();
  await worker.close();
  return caught;
};

const produceShutdownRejection = async (): Promise<unknown> => {
  const worker = createSerialFlushWorker(
    (task: () => Promise<number>) => task(),
    { budget: WEIGHT_BUDGET, capacity: 50 },
  );
  const hold = await worker.reserve(WEIGHT_BUDGET);
  let caught: unknown = null;
  const parked = worker.reserve(WEIGHT_BUDGET).catch((error: unknown) => {
    caught = error;
    return null;
  });
  await worker.close();
  await parked;
  hold.release();
  return caught;
};

describe("backoff gate source pins", () => {
  it("keeps every family's gate routed through the infrastructure exemption", () => {
    const source = readFileSync(
      new URL("../../src/ingest/ingest-sources.ts", import.meta.url),
      "utf8",
    );

    const gateOccurrences = source.match(/!isIngestInfrastructureError\(error\)/gu) ?? [];
    // OAuth's third gate folds the predicate into requiresReauthentication.
    expect(gateOccurrences.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain(
      "!shouldTreatAsProviderAuthFailure(error)\n                && !isIngestInfrastructureError(error)",
    );
    expect(source).not.toContain("}, () => true)");
  });
});

describe("CalDAV backoff gate versus ingest infrastructure errors", () => {
  it("exempts a budget-starved reserve timeout from provider backoff", async () => {
    const caught = await produceBudgetStarvationTimeout();
    expect(caught).toBeInstanceOf(OperationTimeoutError);
    expect(isIngestInfrastructureError(caught)).toBe(true);
    expect(shouldApplyCalDavIngestBackoff(caught)).toBe(false);
  });

  it("exempts a shutdown-rejected parked reserve from provider backoff", async () => {
    const caught = await produceShutdownRejection();
    expect(isIngestInfrastructureError(caught)).toBe(true);
    expect(shouldApplyCalDavIngestBackoff(caught)).toBe(false);
  });
});

describe("ICS backoff gate versus ingest infrastructure errors", () => {
  it("exempts a budget-starved reserve timeout from provider backoff", async () => {
    const caught = await produceBudgetStarvationTimeout();
    expect(caught).toBeInstanceOf(OperationTimeoutError);
    expect(isIngestInfrastructureError(caught)).toBe(true);
    expect(shouldApplyIcsIngestBackoff(caught)).toBe(false);
  });

  it("exempts a shutdown-rejected parked reserve from provider backoff", async () => {
    const caught = await produceShutdownRejection();
    expect(isIngestInfrastructureError(caught)).toBe(true);
    expect(shouldApplyIcsIngestBackoff(caught)).toBe(false);
  });
});

describe("backoff gates versus a response over the size limit", () => {
  const oversizedResponse = new ResponseTooLargeError(1024);
  const oversizedFeed = new CalendarFetchError("Calendar feed is too large.", {
    cause: oversizedResponse,
    reason: "too_large",
  });

  it("backs off a CalDAV calendar whose response is over the limit", () => {
    expect(shouldApplyCalDavIngestBackoff(oversizedResponse)).toBe(true);
  });

  it("backs off an ICS feed that is over the limit", () => {
    expect(shouldApplyIcsIngestBackoff(oversizedFeed)).toBe(true);
  });

  it("does not read an oversized response as a missing calendar", () => {
    expect(resolveMissingCalendarFailure(oversizedResponse)).toBeNull();
  });

  it("spaces each repeated failure further apart than the last", () => {
    const schedule = { intervalMs: 60_000, jitterMs: 0 };
    const first = resolveIngestScheduleDecision(
      { backoff: true, kind: "failed" },
      { ...schedule, failureCount: 0 },
    );
    const second = resolveIngestScheduleDecision(
      { backoff: true, kind: "failed" },
      { ...schedule, failureCount: first.failureCount },
    );

    expect(first.nextDueInMs).toBe(resolveCalendarBackoffDelayMs(0));
    expect(first.nextDueInMs).toBeGreaterThan(schedule.intervalMs);
    expect(second.nextDueInMs).toBeGreaterThan(first.nextDueInMs);
  });
});
