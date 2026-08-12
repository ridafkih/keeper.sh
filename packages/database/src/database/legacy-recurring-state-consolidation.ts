interface LegacyRecurringStateCompatibility {
  has_legacy_index: boolean;
  has_recurrence_column: boolean;
  has_recurring_index: boolean;
  has_source_event_column: boolean;
}

/**
 * Databases at 0070-0074 predate the sourceEventId column that 0075 adds, so
 * every row there is implicitly an unresolved source event. Consolidation
 * cannot be skipped for them: 0076 builds a unique index over exactly these
 * rows and fails on the duplicates consolidation exists to remove.
 */
const shouldConsolidateLegacyRecurringStates = (
  state: LegacyRecurringStateCompatibility | null,
): state is LegacyRecurringStateCompatibility => {
  if (!state) {
    return false;
  }
  return state.has_legacy_index
    && state.has_recurrence_column
    && !state.has_recurring_index;
};

const buildLegacySourceEventFilter = (
  hasSourceEventColumn: boolean,
): string => {
  if (hasSourceEventColumn) {
    return `"sourceEventId" IS NULL AND `;
  }
  return "";
};

const buildLegacyRecurringStateConsolidation = (
  hasSourceEventColumn: boolean,
): string[] => {
  const legacySourceEventFilter = buildLegacySourceEventFilter(
    hasSourceEventColumn,
  );
  return [
    `
      CREATE TEMP TABLE keeper_recurring_state_consolidation
      ON COMMIT DROP
      AS
      WITH ranked_states AS (
        SELECT
          "id",
          first_value("id") OVER (
            PARTITION BY "calendarId", "sourceEventUid", "recurrenceId"
            ORDER BY "createdAt" DESC, "id" DESC
          ) AS canonical_id
        FROM "event_states"
        WHERE ${legacySourceEventFilter}"sourceEventUid" IS NOT NULL
          AND "recurrenceId" IS NOT NULL
      )
      SELECT
        mappings."id" AS mapping_id,
        states."id" AS event_state_id,
        states.canonical_id,
        row_number() OVER (
          PARTITION BY states.canonical_id, mappings."calendarId"
          ORDER BY
            (states."id" = states.canonical_id) DESC,
            mappings."createdAt" DESC,
            mappings."id" DESC
        ) AS mapping_rank
      FROM ranked_states states
      INNER JOIN "event_mappings" mappings
        ON mappings."eventStateId" = states."id"
    `,
    `
      DELETE FROM "event_mappings" mappings
      USING keeper_recurring_state_consolidation consolidation
      WHERE mappings."id" = consolidation.mapping_id
        AND consolidation.mapping_rank > 1
    `,
    `
      UPDATE "event_mappings" mappings
      SET "eventStateId" = consolidation.canonical_id
      FROM keeper_recurring_state_consolidation consolidation
      WHERE mappings."id" = consolidation.mapping_id
        AND consolidation.mapping_rank = 1
        AND consolidation.event_state_id <> consolidation.canonical_id
    `,
    `
      WITH ranked_states AS (
        SELECT
          "id",
          first_value("id") OVER (
            PARTITION BY "calendarId", "sourceEventUid", "recurrenceId"
            ORDER BY "createdAt" DESC, "id" DESC
          ) AS canonical_id
        FROM "event_states"
        WHERE ${legacySourceEventFilter}"sourceEventUid" IS NOT NULL
          AND "recurrenceId" IS NOT NULL
      )
      DELETE FROM "event_states" events
      USING ranked_states states
      WHERE events."id" = states."id"
        AND states."id" <> states.canonical_id
    `,
  ];
};

export {
  buildLegacyRecurringStateConsolidation,
  buildLegacySourceEventFilter,
  shouldConsolidateLegacyRecurringStates,
};
export type { LegacyRecurringStateCompatibility };
