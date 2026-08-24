import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "@keeper.sh/calendar";
import {
  WEIGHT_BUDGET,
} from "../../src/utils/ingest-weight";
import { OperationTimeoutError, withAbortTimeout } from "../../src/utils/with-abort-timeout";
import { isIngestInfrastructureError } from "../../src/utils/error-flags";
import { shouldTreatAsProviderAuthFailure } from "../../src/utils/provider-ingest-failure";

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
      new URL("../../src/jobs/ingest-sources.ts", import.meta.url),
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
