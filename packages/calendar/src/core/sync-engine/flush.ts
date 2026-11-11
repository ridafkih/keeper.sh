import type { BunSQLClient } from "../database-client";
import { eventMappingsTable, eventStatesTable } from "@keeper.sh/database/schema";
import { eq, inArray } from "drizzle-orm";
import type { BunSQLTransactionClient } from "../database-client";
import type { PendingChanges, PendingInsert } from "./types";

const FLUSH_BATCH_SIZE = 5000;

const chunk = <TItem>(items: TItem[], size: number): TItem[][] => {
  const chunks: TItem[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
};

const lockSurvivingEventStates = async (
  transaction: BunSQLTransactionClient,
  inserts: PendingInsert[],
): Promise<Set<string>> => {
  const rows = await transaction
    .select({ id: eventStatesTable.id })
    .from(eventStatesTable)
    .where(inArray(eventStatesTable.id, [...new Set(inserts.map(({ eventStateId }) => eventStateId))]))
    .for("key share");
  return new Set(rows.map(({ id }) => id));
};

const resolveSurvivingEventStateId = (
  insert: PendingInsert,
  survivingEventStateIds: ReadonlySet<string>,
): string | null => {
  if (survivingEventStateIds.has(insert.eventStateId)) {
    return insert.eventStateId;
  }
  return null;
};

const createDatabaseFlush = (database: BunSQLClient): (changes: PendingChanges) => Promise<void> =>
  async (changes: PendingChanges): Promise<void> => {
    const updates = changes.updates ?? [];
    if (changes.inserts.length === 0 && changes.deletes.length === 0 && updates.length === 0) {
      return;
    }

    await database.transaction(async (transaction) => {
      if (changes.deletes.length > 0) {
        const deleteBatches = chunk(changes.deletes, FLUSH_BATCH_SIZE);
        for (const batch of deleteBatches) {
          await transaction
            .delete(eventMappingsTable)
            .where(inArray(eventMappingsTable.id, batch));
        }
      }

      if (changes.inserts.length > 0) {
        const insertBatches = chunk(changes.inserts, FLUSH_BATCH_SIZE);
        for (const batch of insertBatches) {
          const survivingEventStateIds = await lockSurvivingEventStates(transaction, batch);
          await transaction.insert(eventMappingsTable).values(
            batch.map((insert) => ({
              eventStateId: resolveSurvivingEventStateId(insert, survivingEventStateIds),
              sourceCalendarId: insert.sourceCalendarId,
              syncEventId: insert.syncEventId,
              calendarId: insert.calendarId,
              destinationEventUid: insert.destinationEventUid,
              deleteIdentifier: insert.deleteIdentifier,
              syncEventHash: insert.syncEventHash,
              startTime: insert.startTime,
              endTime: insert.endTime,
            })),
          ).onConflictDoNothing();
        }
      }

      if (updates.length > 0) {
        const updateBatches = chunk(updates, FLUSH_BATCH_SIZE);
        for (const batch of updateBatches) {
          for (const update of batch) {
            await transaction
              .update(eventMappingsTable)
              .set({
                deleteIdentifier: update.deleteIdentifier,
                syncEventHash: update.syncEventHash,
                syncEventId: update.syncEventId,
                startTime: update.startTime,
                endTime: update.endTime,
              })
              .where(eq(eventMappingsTable.id, update.id));
          }
        }
      }
    });
  };

export { createDatabaseFlush, FLUSH_BATCH_SIZE };
