import { count, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eventMappingsTable } from "./schema";

interface EventMappingBackfillTransaction {
  backfillMissingIdentities: () => Promise<void>;
  countMissingIdentities: () => Promise<number>;
}

interface EventMappingBackfillDatabase {
  withWriteLock: <TResult>(
    work: (transaction: EventMappingBackfillTransaction) => Promise<TResult>,
  ) => Promise<TResult>;
}

const createEventMappingBackfillDatabase = (
  database: NodePgDatabase,
): EventMappingBackfillDatabase => ({
  withWriteLock: (work) => database.transaction(async (transaction) => {
    await transaction.execute(
      sql`lock table ${eventMappingsTable} in share row exclusive mode`,
    );

    return work({
      backfillMissingIdentities: async () => {
        await transaction
          .update(eventMappingsTable)
          .set({ syncEventId: sql`cast(${eventMappingsTable.eventStateId} as text)` })
          .where(isNull(eventMappingsTable.syncEventId));
      },
      countMissingIdentities: async () => {
        const [result] = await transaction
          .select({ value: count() })
          .from(eventMappingsTable)
          .where(isNull(eventMappingsTable.syncEventId));
        return result?.value ?? 0;
      },
    });
  }),
});

const backfillEventMappingSyncEventIds = (
  database: EventMappingBackfillDatabase,
): Promise<void> => database.withWriteLock(async (transaction) => {
  await transaction.backfillMissingIdentities();
  const remainingCount = await transaction.countMissingIdentities();

  if (remainingCount !== 0) {
    throw new Error(
      `Event mapping sync identity backfill left ${remainingCount} rows unresolved`,
    );
  }
});

export {
  backfillEventMappingSyncEventIds,
  createEventMappingBackfillDatabase,
};
export type {
  EventMappingBackfillDatabase,
  EventMappingBackfillTransaction,
};
