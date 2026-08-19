import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "@keeper.sh/calendar";
import {
  NEVER_INGESTED_WEIGHT,
  WEIGHT_BUDGET,
} from "../../src/utils/ingest-weight";
import { OperationTimeoutError, withAbortTimeout } from "../../src/utils/with-abort-timeout";
import { isIngestInfrastructureError } from "../../src/utils/error-flags";
import { shouldTreatAsProviderAuthFailure } from "../../src/utils/provider-ingest-failure";

/*
 * Flush-budget starvation (an OperationTimeoutError from a reserve parked on
 * the exhausted shared 64MB budget) and writer shutdown never contacted the
 * provider, so no family's backoff gate may punish the calendar with provider
 * exponential backoff. The gates live as inline lambdas in ingest-sources.ts;
 * they are mirrored here for behavioral assertion, and a source-text pin below
 * fails this suite if the production lambdas stop matching the mirrors.
 */

// Mirror of the CalDAV gate in ingest-sources.ts (pinned below).
const shouldApplyCalDavIngestBackoff = (error: unknown): boolean =>
  !shouldTreatAsProviderAuthFailure(error) && !isIngestInfrastructureError(error);

// Mirror of the ICS gate in ingest-sources.ts (pinned below).
const shouldApplyIcsIngestBackoff = (error: unknown): boolean =>
  !isIngestInfrastructureError(error);

const COLD_START_SOURCES = 8;
const SHORT_DEADLINE_MS = 50;

const produceBudgetStarvationTimeout = async (): Promise<unknown> => {
  const worker = createSerialFlushWorker(
    (task: () => Promise<number>) => task(),
    { budget: WEIGHT_BUDGET, capacity: 50 },
  );
  const holds = await Promise.all(
    Array.from({ length: COLD_START_SOURCES }, () =>
      worker.reserve(NEVER_INGESTED_WEIGHT)),
  );
  let caught: unknown = null;
  try {
    await withAbortTimeout(
      (signal) => worker.reserve(NEVER_INGESTED_WEIGHT, signal),
      SHORT_DEADLINE_MS,
    );
  } catch (error) {
    caught = error;
  }
  for (const hold of holds) {
    hold.release();
  }
  await worker.close();
  return caught;
};

const produceShutdownRejection = async (): Promise<unknown> => {
  const worker = createSerialFlushWorker(
    (task: () => Promise<number>) => task(),
    { budget: WEIGHT_BUDGET, capacity: 50 },
  );
  const holds = await Promise.all(
    Array.from({ length: COLD_START_SOURCES }, () =>
      worker.reserve(NEVER_INGESTED_WEIGHT)),
  );
  let caught: unknown = null;
  const parked = worker.reserve(NEVER_INGESTED_WEIGHT).catch((error: unknown) => {
    caught = error;
    return null;
  });
  await worker.close();
  await parked;
  for (const hold of holds) {
    hold.release();
  }
  return caught;
};

describe("backoff gate source pins", () => {
  it("keeps every family's gate routed through the infrastructure exemption", () => {
    const source = readFileSync(
      new URL("../../src/jobs/ingest-sources.ts", import.meta.url),
      "utf8",
    );

    const gateOccurrences = source.match(/!isIngestInfrastructureError\(error\)/gu) ?? [];
    /*
     * CalDAV and ICS gates inline the exemption; OAuth routes through
     * requiresReauthentication, which folds the same predicate in.
     */
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
