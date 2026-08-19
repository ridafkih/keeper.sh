import { count, eq } from "drizzle-orm";
import { eventStatesTable } from "@keeper.sh/database/schema";

/*
 * Sized BEFORE the fetch begins, so the estimate comes from the previous ingest's stored
 * count. Payloads vary by two-plus orders of magnitude, so a byte-weight estimate bounds
 * memory where a count-based limit cannot.
 */
const BYTES_PER_EVENT = 1024;
const WEIGHT_FLOOR = 16_384;
const WEIGHT_BUDGET = 64 * 1024 * 1024;
/* No history to size from; an eighth of the budget self-limits a launch flood to ~8 fetches. */
const NEVER_INGESTED_WEIGHT = WEIGHT_BUDGET / 8;

interface IngestWeightDependencies {
  countStoredEvents: (calendarId: string) => Promise<number>;
}

const estimateIngestWeight = async (
  dependencies: IngestWeightDependencies,
  calendarId: string,
  hasEverIngested: boolean,
): Promise<number> => {
  if (!hasEverIngested) {
    return NEVER_INGESTED_WEIGHT;
  }
  try {
    const storedCount = await dependencies.countStoredEvents(calendarId);
    return Math.min(
      Math.max(storedCount * BYTES_PER_EVENT, WEIGHT_FLOOR),
      WEIGHT_BUDGET,
    );
  } catch {
    return NEVER_INGESTED_WEIGHT;
  }
};

interface EventStateCountClient {
  select: (fields: { count: ReturnType<typeof count> }) => {
    from: (table: typeof eventStatesTable) => {
      where: (
        condition: ReturnType<typeof eq>,
      ) => PromiseLike<{ count: number }[]>;
    };
  };
}

const countStoredEvents = async (
  database: EventStateCountClient,
  calendarId: string,
): Promise<number> => {
  const rows = await database
    .select({ count: count() })
    .from(eventStatesTable)
    .where(eq(eventStatesTable.calendarId, calendarId));
  return rows[0]?.count ?? 0;
};

export {
  BYTES_PER_EVENT,
  WEIGHT_BUDGET,
  WEIGHT_FLOOR,
  NEVER_INGESTED_WEIGHT,
  countStoredEvents,
  estimateIngestWeight,
};
export type { EventStateCountClient, IngestWeightDependencies };
