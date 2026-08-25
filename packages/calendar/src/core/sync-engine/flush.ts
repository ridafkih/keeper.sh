import type { BunSQLClient } from "../database-client";
import { eventMappingsTable } from "@keeper.sh/database/schema";
import { inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PendingChanges, PendingUpdate } from "./types";

const FLUSH_BATCH_SIZE = 5000;

const chunk = <TItem>(items: TItem[], size: number): TItem[][] => {
  const chunks: TItem[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
};

const toTimestampParameter = (value: Date | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  return value.toISOString();
};

/*
 * An update with no observed baseline sends null and coalesce keeps what the row records:
 * nulling it would downgrade an already-protected mapping back to having none. All four recorded
 * fields travel that way, because one throttled read must not cost a whole chunk its baseline.
 */
const buildUpdateRow = (update: PendingUpdate): SQL => sql`(
  ${update.id}::uuid,
  ${update.deleteIdentifier}::text,
  ${update.destinationEventUid ?? null}::text,
  ${update.syncEventHash}::text,
  ${update.remoteContentHash ?? null}::text,
  ${update.remoteContentHashRepairedFrom ?? null}::text,
  ${update.remoteAvailability ?? null}::text,
  ${toTimestampParameter(update.remoteStartTime)}::timestamptz,
  ${toTimestampParameter(update.remoteEndTime)}::timestamptz,
  ${update.syncEventId}::text,
  ${update.startTime.toISOString()}::timestamptz,
  ${update.endTime.toISOString()}::timestamptz,
  ${update.consecutiveUpdateFailures ?? null}::integer
)`;

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
              sourceCalendarId: insert.sourceCalendarId,
              syncEventId: insert.syncEventId,
              calendarId: insert.calendarId,
              destinationEventUid: insert.destinationEventUid,
              deleteIdentifier: insert.deleteIdentifier,
              syncEventHash: insert.syncEventHash,
              remoteContentHash: insert.remoteContentHash,
              remoteContentHashRepairedFrom: insert.remoteContentHashRepairedFrom ?? null,
              remoteAvailability: insert.remoteAvailability,
              remoteEndTime: insert.remoteEndTime,
              remoteStartTime: insert.remoteStartTime,
              startTime: insert.startTime,
              endTime: insert.endTime,
            })),
          ).onConflictDoNothing();
        }
      }

      if (updates.length > 0) {
        const updateBatches = chunk(updates, FLUSH_BATCH_SIZE);
        for (const batch of updateBatches) {
                    const rows = batch.map((update) => buildUpdateRow(update));
          await transaction.execute(sql`
            update "event_mappings" as target set
              "deleteIdentifier" = source."deleteIdentifier",
              "destinationEventUid" = coalesce(
                source."destinationEventUid", target."destinationEventUid"
              ),
              "syncEventHash" = source."syncEventHash",
              "remoteContentHash" = coalesce(source."remoteContentHash", target."remoteContentHash"),
              "remoteContentHashRepairedFrom" = source."remoteContentHashRepairedFrom",
              "remoteAvailability" = coalesce(source."remoteAvailability", target."remoteAvailability"),
              "remoteEndTime" = coalesce(source."remoteEndTime", target."remoteEndTime"),
              "remoteStartTime" = coalesce(source."remoteStartTime", target."remoteStartTime"),
              "syncEventId" = source."syncEventId",
              "startTime" = source."startTime",
              "endTime" = source."endTime",
              "consecutiveUpdateFailures" = coalesce(
                source."consecutiveUpdateFailures", target."consecutiveUpdateFailures"
              )
            from (values ${sql.join(rows, sql`, `)}) as source (
              "id",
              "deleteIdentifier",
              "destinationEventUid",
              "syncEventHash",
              "remoteContentHash",
              "remoteContentHashRepairedFrom",
              "remoteAvailability",
              "remoteStartTime",
              "remoteEndTime",
              "syncEventId",
              "startTime",
              "endTime",
              "consecutiveUpdateFailures"
            )
            where target."id" = source."id"
          `);
        }
      }
    });
  };

export { createDatabaseFlush, FLUSH_BATCH_SIZE };
