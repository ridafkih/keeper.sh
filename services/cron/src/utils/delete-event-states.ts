import { and, eq, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { eventStatesTable } from "@keeper.sh/database/schema";

/*
 * Postgres caps a bind message at 65535 parameters and this delete spends one per
 * id. Snapshot sources removed every stored row absent from the feed, and ICS
 * history is unbounded, so a feed that regenerates its UIDs can exceed the ceiling
 * in one statement — which rolls the whole ingest back and recurs every tick.
 */
const DELETE_CHUNK_SIZE = 5000;

interface EventStateDeleteClient {
  delete: (table: typeof eventStatesTable) => {
    where: (condition: SQL<unknown> | undefined) => PromiseLike<unknown>;
  };
}

const deleteEventStatesInChunks = async (
  database: EventStateDeleteClient,
  calendarId: string,
  eventStateIds: string[],
  onChunk?: (chunkedIds: string[]) => void,
): Promise<void> => {
  for (let offset = 0; offset < eventStateIds.length; offset += DELETE_CHUNK_SIZE) {
    const chunkedIds = eventStateIds.slice(offset, offset + DELETE_CHUNK_SIZE);
    onChunk?.(chunkedIds);
    await database
      .delete(eventStatesTable)
      .where(and(
        eq(eventStatesTable.calendarId, calendarId),
        inArray(eventStatesTable.id, chunkedIds),
      ));
  }
};

export { DELETE_CHUNK_SIZE, deleteEventStatesInChunks };
export type { EventStateDeleteClient };
