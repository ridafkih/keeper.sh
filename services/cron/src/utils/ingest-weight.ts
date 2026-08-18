import { count, eq } from "drizzle-orm";
import { eventStatesTable } from "@keeper.sh/database/schema";

/*
 * Weighted-permit sizing for provider ingests. The permit must be sized
 * BEFORE the provider fetch begins, so the estimate comes from what we
 * already know: the stored event count from the previous ingest. Items vary
 * by two-plus orders of magnitude (a 12-event personal calendar vs a
 * 3,000-event ICS feed), so a byte-weight estimate bounds memory where a
 * count-based limit cannot.
 */
const BYTES_PER_EVENT = 1024;
const WEIGHT_FLOOR = 16_384;
// 64MB budget: 64 * 1024 * 1024 bytes.
const WEIGHT_BUDGET = 67_108_864;
/*
 * A never-ingested calendar has no history to size from. Claiming an eighth
 * of the budget self-limits a launch flood of unknown-size first ingests to
 * roughly eight concurrent fetches.
 */
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
    // A failed count read must not fail the ingest; size it like an unknown.
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

// Reads go against the pooled database, never through the flush writer.
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
