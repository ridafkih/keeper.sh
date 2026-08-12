import { describe, expect, it, vi } from "vitest";
import {
  backfillEventMappingSourceCalendarIds,
  type EventMappingSourceBackfillDatabase,
} from "../../src/database/backfill-event-mapping-source-calendar-ids";

const createDatabase = (
  batchCounts: number[],
  remainingCount: number,
): {
  backfillMissingSourceCalendarIdsBatch: ReturnType<typeof vi.fn>;
  countMissingSourceCalendarIds: ReturnType<typeof vi.fn>;
  database: EventMappingSourceBackfillDatabase;
} => {
  const pendingBatchCounts = [...batchCounts];
  let processedCount = 0;
  const backfillMissingSourceCalendarIdsBatch = vi.fn(() => {
    const updatedCount = pendingBatchCounts.shift() ?? 0;
    processedCount += updatedCount;
    if (updatedCount === 0) {
      return Promise.resolve({ lastId: null, updatedCount });
    }
    return Promise.resolve({ lastId: `mapping-${processedCount}`, updatedCount });
  });
  const countMissingSourceCalendarIds = vi.fn(() => Promise.resolve(remainingCount));
  return {
    backfillMissingSourceCalendarIdsBatch,
    countMissingSourceCalendarIds,
    database: {
      backfillMissingSourceCalendarIdsBatch,
      countMissingSourceCalendarIds,
    },
  };
};

describe("event mapping source calendar backfill", () => {
  it("backfills and verifies legacy mappings in bounded batches", async () => {
    const context = createDatabase([1000, 20, 0], 0);

    await expect(
      backfillEventMappingSourceCalendarIds(context.database),
    ).resolves.toBeUndefined();

    expect(context.backfillMissingSourceCalendarIdsBatch).toHaveBeenCalledTimes(3);
    expect(context.backfillMissingSourceCalendarIdsBatch.mock.calls).toEqual([
      [1000, null],
      [1000, "mapping-1000"],
      [1000, "mapping-1020"],
    ]);
    expect(context.countMissingSourceCalendarIds).toHaveBeenCalledOnce();
  });

  it("fails when a live mapping source identity cannot be recovered", async () => {
    const context = createDatabase([0], 1);

    await expect(
      backfillEventMappingSourceCalendarIds(context.database),
    ).rejects.toThrow("left 1 rows unresolved");
  });
});
