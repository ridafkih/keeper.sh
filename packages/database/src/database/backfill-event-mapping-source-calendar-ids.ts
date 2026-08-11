import { and, asc, count, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eventMappingsTable, eventStatesTable } from "./schema";

const EVENT_MAPPING_SOURCE_BACKFILL_BATCH_SIZE = 1000;

const buildCursorFilter = (afterId: string | null): SQL => {
  if (afterId === null) {
    return sql`true`;
  }
  return gt(eventMappingsTable.id, afterId);
};

interface EventMappingSourceBackfillBatch {
  lastId: string | null;
  updatedCount: number;
}

interface EventMappingSourceBackfillDatabase {
  backfillMissingSourceCalendarIdsBatch: (
    batchSize: number,
    afterId: string | null,
  ) => Promise<EventMappingSourceBackfillBatch>;
  countMissingSourceCalendarIds: () => Promise<number>;
}

const createEventMappingSourceBackfillDatabase = (
  database: NodePgDatabase,
): EventMappingSourceBackfillDatabase => ({
  backfillMissingSourceCalendarIdsBatch: (batchSize, afterId) =>
    database.transaction(async (transaction) => {
      const rows = await transaction
        .select({ id: eventMappingsTable.id })
        .from(eventMappingsTable)
        .innerJoin(eventStatesTable, eq(eventMappingsTable.eventStateId, eventStatesTable.id))
        .where(and(
          isNull(eventMappingsTable.sourceCalendarId),
          buildCursorFilter(afterId),
        ))
        .orderBy(asc(eventMappingsTable.id))
        .limit(batchSize)
        .for("update", { of: eventMappingsTable });
      if (rows.length === 0) {
        return { lastId: null, updatedCount: 0 };
      }

      await transaction
        .update(eventMappingsTable)
        .set({
          sourceCalendarId: sql`(
            select ${eventStatesTable.calendarId}
            from ${eventStatesTable}
            where ${eventStatesTable.id} = ${eventMappingsTable.eventStateId}
          )`,
        })
        .where(and(
          inArray(eventMappingsTable.id, rows.map(({ id }) => id)),
          isNull(eventMappingsTable.sourceCalendarId),
        ));
      return {
        lastId: rows.at(-1)?.id ?? null,
        updatedCount: rows.length,
      };
    }),
  countMissingSourceCalendarIds: async () => {
    const [result] = await database
      .select({ value: count() })
      .from(eventMappingsTable)
      .where(and(
        isNull(eventMappingsTable.sourceCalendarId),
        isNotNull(eventMappingsTable.eventStateId),
      ));
    return result?.value ?? 0;
  },
});

const backfillEventMappingSourceCalendarIds = async (
  database: EventMappingSourceBackfillDatabase,
): Promise<void> => {
  let batch: EventMappingSourceBackfillBatch = { lastId: null, updatedCount: 0 };
  do {
    batch = await database.backfillMissingSourceCalendarIdsBatch(
      EVENT_MAPPING_SOURCE_BACKFILL_BATCH_SIZE,
      batch.lastId,
    );
  } while (batch.updatedCount > 0);

  const remainingCount = await database.countMissingSourceCalendarIds();
  if (remainingCount !== 0) {
    throw new Error(
      `Event mapping source calendar backfill left ${remainingCount} rows unresolved`,
    );
  }
};

export {
  backfillEventMappingSourceCalendarIds,
  createEventMappingSourceBackfillDatabase,
};
export type {
  EventMappingSourceBackfillBatch,
  EventMappingSourceBackfillDatabase,
};
