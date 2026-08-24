import { describe, expect, it, vi } from "vitest";
import {
  backfillEventMappingSyncEventIds,
  type EventMappingBackfillDatabase,
} from "../../src/database/backfill-event-mapping-sync-event-ids";

const createDatabase = (
  batchCounts: number[],
  remainingCount: number,
): {
  backfillMissingIdentitiesBatch: ReturnType<typeof vi.fn>;
  countMissingIdentities: ReturnType<typeof vi.fn>;
  database: EventMappingBackfillDatabase;
} => {
  const pendingBatchCounts = [...batchCounts];
  const backfillMissingIdentitiesBatch = vi.fn(
    () => Promise.resolve(pendingBatchCounts.shift() ?? 0),
  );
  const countMissingIdentities = vi.fn(() => Promise.resolve(remainingCount));
  const database: EventMappingBackfillDatabase = {
    backfillMissingIdentitiesBatch,
    countMissingIdentities,
  };

  return {
    backfillMissingIdentitiesBatch,
    countMissingIdentities,
    database,
  };
};

describe("event mapping sync identity backfill", () => {
  it("backfills and verifies legacy mappings in bounded batches", async () => {
    const context = createDatabase([1000, 25, 0], 0);

    await expect(backfillEventMappingSyncEventIds(context.database)).resolves.toBeUndefined();

    expect(context.backfillMissingIdentitiesBatch).toHaveBeenCalledTimes(3);
    expect(context.backfillMissingIdentitiesBatch).toHaveBeenCalledWith(1000);
    expect(context.countMissingIdentities).toHaveBeenCalledOnce();
  });

  it("is idempotent when every mapping already has a sync identity", async () => {
    const context = createDatabase([0], 0);

    await expect(backfillEventMappingSyncEventIds(context.database)).resolves.toBeUndefined();

    expect(context.backfillMissingIdentitiesBatch).toHaveBeenCalledOnce();
    expect(context.countMissingIdentities).toHaveBeenCalledOnce();
  });

  it("fails verification when any mapping remains unresolved", async () => {
    const context = createDatabase([0], 1);

    await expect(backfillEventMappingSyncEventIds(context.database)).rejects.toThrow(
      "left 1 rows unresolved",
    );
  });
});
