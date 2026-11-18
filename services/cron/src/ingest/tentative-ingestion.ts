import { sql } from "drizzle-orm";

const TENTATIVE_AVAILABILITY = "tentative";

const DESTINATION_EXCLUDES_TENTATIVE = sql<boolean>`exists (
  select 1 from "source_destination_mappings"
  where "source_destination_mappings"."sourceCalendarId" = "calendars"."id"
    and ${TENTATIVE_AVAILABILITY} = any("source_destination_mappings"."excludeAvailabilities")
) or exists (
  select 1 from "source_destination_mappings" as "chained_mappings"
  inner join "calendars" as "chained_sources"
    on "chained_sources"."id" = "chained_mappings"."sourceCalendarId"
  where "chained_mappings"."includeUpstreamSources"
    and "chained_sources"."userId" = "calendars"."userId"
    and ${TENTATIVE_AVAILABILITY} = any(coalesce(
      "chained_mappings"."excludeAvailabilities",
      "chained_sources"."excludeAvailabilities"
    ))
)`;

interface TentativeExclusionState {
  excludeAvailabilities: string[];
  excludesTentativeForADestination?: boolean | null;
}

const requiresTentativeIngestion = (source: TentativeExclusionState): boolean =>
  source.excludeAvailabilities.includes(TENTATIVE_AVAILABILITY)
  || source.excludesTentativeForADestination === true;

export { DESTINATION_EXCLUDES_TENTATIVE, requiresTentativeIngestion };
