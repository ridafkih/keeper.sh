import { eventStatesTable, userEventsTable } from "@keeper.sh/database/schema";
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/*
 * Creating an event through the API writes it to the provider and records a
 * user_events row so the event is readable before the source calendar is next
 * pulled. Once a pull ingests the provider's copy into event_states, that row is
 * the event, so the placeholder hands its id to the ingested row and is removed.
 */

interface PlaceholderRow {
  calendarId: string;
  id: string;
  sourceEventUid: string | null;
}

interface IngestedRow {
  calendarId: string;
  id?: string;
  recurrenceId?: Date | null;
  sourceEventUid?: string | null;
}

interface UserEventPlaceholderClient {
  delete: (table: typeof userEventsTable) => {
    where: (condition: SQL | undefined) => PromiseLike<unknown>;
  };
  select: (fields: {
    calendarId: typeof userEventsTable.calendarId;
    id: typeof userEventsTable.id;
    sourceEventUid: typeof userEventsTable.sourceEventUid;
  }) => {
    from: (table: typeof userEventsTable) => {
      where: (condition: SQL | undefined) => PromiseLike<PlaceholderRow[]>;
    };
  };
}

const placeholderKey = (calendarId: string, sourceEventUid: string): string =>
  `${calendarId}\u0000${sourceEventUid}`;

const unique = (values: string[]): string[] => [...new Set(values)];

const isSeriesOrSingleEvent = (row: IngestedRow): row is IngestedRow & { sourceEventUid: string } =>
  typeof row.sourceEventUid === "string" && !row.recurrenceId;

const findPlaceholders = async (
  database: UserEventPlaceholderClient,
  rows: (IngestedRow & { sourceEventUid: string })[],
): Promise<Map<string, string>> => {
  const placeholders = await database
    .select({
      calendarId: userEventsTable.calendarId,
      id: userEventsTable.id,
      sourceEventUid: userEventsTable.sourceEventUid,
    })
    .from(userEventsTable)
    .where(and(
      inArray(userEventsTable.calendarId, unique(rows.map((row) => row.calendarId))),
      inArray(userEventsTable.sourceEventUid, unique(rows.map((row) => row.sourceEventUid))),
    ));

  const placeholderIds = new Map<string, string>();
  for (const placeholder of placeholders) {
    if (placeholder.sourceEventUid) {
      placeholderIds.set(placeholderKey(placeholder.calendarId, placeholder.sourceEventUid), placeholder.id);
    }
  }
  return placeholderIds;
};

const adoptPlaceholderIds = async <Row extends IngestedRow>(
  database: UserEventPlaceholderClient,
  rows: Row[],
): Promise<Row[]> => {
  const candidates = rows.filter((row) => isSeriesOrSingleEvent(row));
  if (candidates.length === 0) {
    return rows;
  }

  const placeholderIds = await findPlaceholders(database, candidates);
  const adopted = new Set<string>();

  return rows.map((row) => {
    if (!isSeriesOrSingleEvent(row) || row.id) {
      return row;
    }
    const key = placeholderKey(row.calendarId, row.sourceEventUid);
    const placeholderId = placeholderIds.get(key);
    if (!placeholderId || adopted.has(key)) {
      return row;
    }
    adopted.add(key);
    return { ...row, id: placeholderId };
  });
};

const removeIngestedPlaceholders = async (
  database: UserEventPlaceholderClient,
  calendarIds: string[],
): Promise<void> => {
  await database
    .delete(userEventsTable)
    .where(and(
      inArray(userEventsTable.calendarId, unique(calendarIds)),
      isNotNull(userEventsTable.sourceEventUid),
      sql`exists (
        select 1 from ${eventStatesTable}
        where ${eventStatesTable.calendarId} = ${userEventsTable.calendarId}
          and ${eventStatesTable.sourceEventUid} = ${userEventsTable.sourceEventUid}
      )`,
    ));
};

export { adoptPlaceholderIds, removeIngestedPlaceholders };
export type { UserEventPlaceholderClient };
