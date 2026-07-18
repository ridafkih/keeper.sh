import { and, asc, count, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eventMappingsTable } from "./schema";

const EVENT_MAPPING_BACKFILL_BATCH_SIZE = 1000;

interface EventMappingBackfillDatabase {
  backfillMissingIdentitiesBatch: (batchSize: number) => Promise<number>;
  countMissingIdentities: () => Promise<number>;
}

const createEventMappingBackfillDatabase = (
  database: NodePgDatabase,
): EventMappingBackfillDatabase => ({
  backfillMissingIdentitiesBatch: (batchSize) => database.transaction(async (transaction) => {
    const rows = await transaction
      .select({ id: eventMappingsTable.id })
      .from(eventMappingsTable)
      .where(isNull(eventMappingsTable.syncEventId))
      .orderBy(asc(eventMappingsTable.id))
      .limit(batchSize)
      .for("update");
    if (rows.length === 0) {
      return 0;
    }

    await transaction
      .update(eventMappingsTable)
      .set({ syncEventId: sql`cast(${eventMappingsTable.eventStateId} as text)` })
      .where(and(
        inArray(eventMappingsTable.id, rows.map(({ id }) => id)),
        isNull(eventMappingsTable.syncEventId),
      ));
    return rows.length;
  }),
  countMissingIdentities: async () => {
    const [result] = await database
      .select({ value: count() })
      .from(eventMappingsTable)
      .where(isNull(eventMappingsTable.syncEventId));
    return result?.value ?? 0;
  },
});

const backfillEventMappingSyncEventIds = async (
  database: EventMappingBackfillDatabase,
): Promise<void> => {
  let updatedCount = 0;
  do {
    updatedCount = await database.backfillMissingIdentitiesBatch(
      EVENT_MAPPING_BACKFILL_BATCH_SIZE,
    );
  } while (updatedCount > 0);

  const remainingCount = await database.countMissingIdentities();

  if (remainingCount !== 0) {
    throw new Error(
      `Event mapping sync identity backfill left ${remainingCount} rows unresolved`,
    );
  }
};

export {
  backfillEventMappingSyncEventIds,
  createEventMappingBackfillDatabase,
};
export type {
  EventMappingBackfillDatabase,
};
