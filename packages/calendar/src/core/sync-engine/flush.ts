import type { BunSQLClient } from "../database-client";
import { eventMappingsTable } from "@keeper.sh/database/schema";
import { inArray, sql } from "drizzle-orm";
import type { PendingChanges } from "./types";

const FLUSH_BATCH_SIZE = 5000;

const chunk = <TItem>(items: TItem[], size: number): TItem[][] => {
  const chunks: TItem[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
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
          await transaction.insert(eventMappingsTable).values(
            batch.map((insert) => ({
              eventStateId: insert.eventStateId,
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
          const serializedUpdates = JSON.stringify(batch.map((update) => ({
            deleteIdentifier: update.deleteIdentifier,
            id: update.id,
            syncEventHash: update.syncEventHash,
            syncEventId: update.syncEventId,
          })));
          await transaction.execute(sql`
            update ${eventMappingsTable}
            set
              "deleteIdentifier" = mapping_updates."deleteIdentifier",
              "syncEventHash" = mapping_updates."syncEventHash",
              "syncEventId" = mapping_updates."syncEventId"
            from jsonb_to_recordset(${serializedUpdates}::jsonb)
              as mapping_updates(
                "deleteIdentifier" text,
                id uuid,
                "syncEventHash" text,
                "syncEventId" text
              )
            where ${eventMappingsTable.id} = mapping_updates.id
          `);
        }
      }
    });
  };

export { createDatabaseFlush, FLUSH_BATCH_SIZE };
