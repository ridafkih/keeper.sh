import { sql } from "drizzle-orm";

const TENTATIVE_AVAILABILITY = "tentative";

const DESTINATION_EXCLUDES_TENTATIVE = sql<boolean>`exists (
  select 1 from "source_destination_mappings"
  where "source_destination_mappings"."sourceCalendarId" = "calendars"."id"
    and ${TENTATIVE_AVAILABILITY} = any("source_destination_mappings"."excludeAvailabilities")
)`;

interface TentativeExclusionState {
  excludeAvailabilities: string[];
  excludesTentativeForADestination?: boolean | null;
}

const requiresTentativeIngestion = (source: TentativeExclusionState): boolean =>
  source.excludeAvailabilities.includes(TENTATIVE_AVAILABILITY)
  || source.excludesTentativeForADestination === true;

export { DESTINATION_EXCLUDES_TENTATIVE, requiresTentativeIngestion };
