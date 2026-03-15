import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { eventMappingsTable } from "@keeper.sh/database/schema";
import { inArray } from "drizzle-orm";
import type { PendingChanges } from "./types";

const createDatabaseFlush = (database: BunSQLDatabase): (changes: PendingChanges) => Promise<void> => {
  return async (changes: PendingChanges): Promise<void> => {
    if (changes.inserts.length === 0 && changes.deletes.length === 0) {
      return;
    }

    await database.transaction(async (transaction) => {
      if (changes.deletes.length > 0) {
        await transaction
          .delete(eventMappingsTable)
          .where(inArray(eventMappingsTable.id, changes.deletes));
      }

      for (const insert of changes.inserts) {
        await transaction.insert(eventMappingsTable).values({
          eventStateId: insert.eventStateId,
          calendarId: insert.calendarId,
          destinationEventUid: insert.destinationEventUid,
          deleteIdentifier: insert.deleteIdentifier,
          syncEventHash: insert.syncEventHash,
          startTime: insert.startTime,
          endTime: insert.endTime,
        });
      }
    });
  };
};

export { createDatabaseFlush };
