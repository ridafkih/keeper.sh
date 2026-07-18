import { describe, expect, it, vi } from "vitest";
import {
  backfillEventMappingSyncEventIds,
  type EventMappingBackfillDatabase,
} from "../../src/database/backfill-event-mapping-sync-event-ids";

const createDatabase = (
  remainingCount: number,
): {
  backfillMissingIdentities: ReturnType<typeof vi.fn>;
  countMissingIdentities: ReturnType<typeof vi.fn>;
  database: EventMappingBackfillDatabase;
  transactionRolledBack: () => boolean;
} => {
  const backfillMissingIdentities = vi.fn(() => Promise.resolve());
  const countMissingIdentities = vi.fn(() => Promise.resolve(remainingCount));
  let rolledBack = false;
  const database: EventMappingBackfillDatabase = {
    withWriteLock: async (work) => {
      try {
        return await work({ backfillMissingIdentities, countMissingIdentities });
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
  };

  return {
    backfillMissingIdentities,
    countMissingIdentities,
    database,
    transactionRolledBack: () => rolledBack,
  };
};

describe("event mapping sync identity backfill", () => {
  it("backfills and verifies every legacy mapping under the database write lock", async () => {
    const context = createDatabase(0);

    await expect(backfillEventMappingSyncEventIds(context.database)).resolves.toBeUndefined();

    expect(context.backfillMissingIdentities).toHaveBeenCalledOnce();
    expect(context.countMissingIdentities).toHaveBeenCalledOnce();
    expect(context.transactionRolledBack()).toBe(false);
  });

  it("fails the transaction when any mapping remains unresolved", async () => {
    const context = createDatabase(1);

    await expect(backfillEventMappingSyncEventIds(context.database)).rejects.toThrow(
      "left 1 rows unresolved",
    );
    expect(context.transactionRolledBack()).toBe(true);
  });
});
