import { count, eq } from "drizzle-orm";
import { eventStatesTable } from "@keeper.sh/database/schema";
import { widelog } from "@/utils/logging";

const BYTES_PER_EVENT = 1024;
const WEIGHT_FLOOR = 16_384;
const WEIGHT_BUDGET = 512 * 1024 * 1024;
const NEVER_INGESTED_EVENT_ESTIMATE = 2048;
const NEVER_INGESTED_WEIGHT = NEVER_INGESTED_EVENT_ESTIMATE * BYTES_PER_EVENT;

interface IngestWeightDependencies {
  countStoredEvents: (calendarId: string) => Promise<number>;
}

const clampWeight = (storedCount: number): number => Math.min(
  Math.max(storedCount * BYTES_PER_EVENT, WEIGHT_FLOOR),
  WEIGHT_BUDGET,
);

const estimateIngestWeight = async (
  dependencies: IngestWeightDependencies,
  calendarId: string,
  hasEverIngested: boolean,
  cachedStoredEventCount?: number | null,
): Promise<number> => {
  if (!hasEverIngested) {
    return NEVER_INGESTED_WEIGHT;
  }
  if (typeof cachedStoredEventCount === "number") {
    return clampWeight(cachedStoredEventCount);
  }
  try {
    const storedCount = await dependencies.countStoredEvents(calendarId);
    return clampWeight(storedCount);
  } catch (error) {
    widelog.errorFields(error, {
      slug: "ingest-weight-estimate-failed",
      retriable: true,
    });
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
