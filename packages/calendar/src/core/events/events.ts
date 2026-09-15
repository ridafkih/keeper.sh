import {
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
  syncRuleAssignmentsTable,
  syncRulesTable,
} from "@keeper.sh/database/schema";
import { applyRuleActions, findMatchingRule } from "@keeper.sh/data-schemas";
import type { RuleEventFacts, SyncRule } from "@keeper.sh/data-schemas";
import { and, asc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import type { BunSQLClient } from "../database-client";
import type {
  EventAvailability,
  MaterializedSyncableEvent,
  SourceEventType,
  SyncableEvent,
} from "../types";
import type { SyncWindow } from "../sync/sync-range";
import { parseStoredRecurrenceForMaterialization } from "./stored-recurrence";
import { materializeRecurrenceEvents } from "./recurrence-materializer";
import { isEmptyTimeRange, isInvertedTimeRange, resolveTimeRangeEnd } from "./time-range";

const EMPTY_SOURCES_COUNT = 0;

interface DestinationEventReadDiagnostics {
  candidateEventStateCount: number;
  emptyTimeRangeCount: number;
  excludedBySyncPolicyCount: number;
  invertedTimeRangeCount: number;
  materializedEventCount: number;
  missingSourceEventUidCount: number;
  outsideReconciliationWindowCount: number;
  overBudgetSourceEventStateIds: string[];
  overBudgetSourceEventUids: string[];
  skippedByRuleCount: number;
  syncableEventCount: number;
  unmatchedByRuleCount: number;
}

type DestinationSyncRule = Pick<SyncRule, "actions" | "conditions" | "id" | "name">;
type RulesBySourceCalendarId = ReadonlyMap<string, DestinationSyncRule[]>;

interface DestinationEventReadOptions {
  destinationCalendarId?: string;
  rulesBySourceCalendarId?: RulesBySourceCalendarId;
}

interface DestinationEventReadResult {
  diagnostics: DestinationEventReadDiagnostics;
  events: MaterializedSyncableEvent[];
}

const EMPTY_DESTINATION_EVENT_READ_DIAGNOSTICS: DestinationEventReadDiagnostics = {
  candidateEventStateCount: 0,
  emptyTimeRangeCount: 0,
  excludedBySyncPolicyCount: 0,
  invertedTimeRangeCount: 0,
  materializedEventCount: 0,
  missingSourceEventUidCount: 0,
  outsideReconciliationWindowCount: 0,
  overBudgetSourceEventStateIds: [],
  overBudgetSourceEventUids: [],
  skippedByRuleCount: 0,
  syncableEventCount: 0,
  unmatchedByRuleCount: 0,
};

const isEventInDestinationReconciliationWindow = (
  event: Pick<SyncableEvent, "endTime" | "startTime">,
  timeMin: Date,
): boolean => resolveTimeRangeEnd(event) >= timeMin;

const orAbsent = <TValue>(value: TValue | null): TValue | undefined => {
  if (value === null) {
    return;
  }
  return value;
};

const orAbsentBoolean = (value: boolean | null): boolean | undefined => {
  if (value === null) {
    return;
  }
  return value;
};

const isEventAvailability = (value: string | null): value is EventAvailability =>
  value === "busy"
  || value === "free"
  || value === "oof"
  || value === "workingElsewhere";

const parseAvailability = (value: string | null): EventAvailability | undefined => {
  if (!isEventAvailability(value)) {
    return;
  }

  return value;
};
const parseSourceEventType = (
  value: string | null,
  availability: string | null,
): SourceEventType => {
  if (value === "focusTime" || value === "outOfOffice" || value === "workingLocation") {
    return value;
  }

  if (availability === "workingElsewhere") {
    return "workingLocation";
  }

  if (availability === "oof") {
    return "outOfOffice";
  }

  return "default";
};

const shouldExcludeSyncEvent = (event: {
  excludeAllDayEvents: boolean;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  availability: string | null;
  isAllDay: boolean | null;
  sourceEventType: string | null;
}): boolean => {
  const sourceEventType = parseSourceEventType(event.sourceEventType, event.availability);

  if (sourceEventType === "workingLocation") {
    return true;
  }
  if (event.excludeAllDayEvents && event.isAllDay) {
    return true;
  }
  if (event.excludeFocusTime && sourceEventType === "focusTime") {
    return true;
  }
  if (event.excludeOutOfOffice && sourceEventType === "outOfOffice") {
    return true;
  }

  return false;
};
const DEFAULT_EVENT_NAME = "Busy";

interface SyncableEventProjectionRow {
  availability: string | null;
  calendarName: string | null;
  description: string | null;
  isAllDay: boolean | null;
  location: string | null;
  sourceEventType: string | null;
  title: string | null;
}

type SyncableEventProjection =
  | { outcome: "skipped" }
  | { outcome: "unmatched" }
  | { outcome: "working_location" }
  | {
    outcome: "copy";
    description?: string;
    isPrivate?: true;
    location?: string;
    summary: string;
  };

// Working-location events never copy, before any rule is consulted, as they never did.
const projectSyncableEvent = (
  row: SyncableEventProjectionRow,
  rules: readonly DestinationSyncRule[],
): SyncableEventProjection => {
  const sourceEventType = parseSourceEventType(row.sourceEventType, row.availability);
  if (sourceEventType === "workingLocation") {
    return { outcome: "working_location" };
  }

  const facts: RuleEventFacts = {
    calendarName: row.calendarName,
    description: orAbsent(row.description),
    isAllDay: row.isAllDay === true,
    isFocusTime: sourceEventType === "focusTime",
    isOutOfOffice: sourceEventType === "outOfOffice",
    location: orAbsent(row.location),
    title: row.title ?? DEFAULT_EVENT_NAME,
  };
  const rule = findMatchingRule(rules, facts);
  if (!rule) {
    return { outcome: "unmatched" };
  }
  const evaluation = applyRuleActions(rule.actions, facts);
  if (evaluation.skip) {
    return { outcome: "skipped" };
  }
  return {
    description: evaluation.description,
    isPrivate: evaluation.isPrivate,
    location: evaluation.location,
    outcome: "copy",
    summary: evaluation.summary,
  };
};

const getSyncRulesForDestination = async (
  database: BunSQLClient,
  destinationCalendarId: string,
  sourceCalendarIds: string[],
): Promise<Map<string, DestinationSyncRule[]>> => {
  const rulesBySourceCalendarId = new Map<string, DestinationSyncRule[]>();
  if (sourceCalendarIds.length === EMPTY_SOURCES_COUNT) {
    return rulesBySourceCalendarId;
  }

  const assignments = await database
    .select({
      actions: syncRulesTable.actions,
      conditions: syncRulesTable.conditions,
      id: syncRulesTable.id,
      name: syncRulesTable.name,
      sourceCalendarId: syncRuleAssignmentsTable.sourceCalendarId,
    })
    .from(syncRuleAssignmentsTable)
    .innerJoin(syncRulesTable, eq(syncRuleAssignmentsTable.ruleId, syncRulesTable.id))
    .where(
      and(
        eq(syncRuleAssignmentsTable.destinationCalendarId, destinationCalendarId),
        inArray(syncRuleAssignmentsTable.sourceCalendarId, sourceCalendarIds),
      ),
    )
    .orderBy(asc(syncRuleAssignmentsTable.sourceCalendarId), asc(syncRuleAssignmentsTable.position));

  for (const assignment of assignments) {
    const rules = rulesBySourceCalendarId.get(assignment.sourceCalendarId) ?? [];
    rules.push({
      actions: assignment.actions,
      conditions: assignment.conditions,
      id: assignment.id,
      name: assignment.name,
    });
    rulesBySourceCalendarId.set(assignment.sourceCalendarId, rules);
  }
  return rulesBySourceCalendarId;
};

const resolveRulesBySourceCalendarId = (
  database: BunSQLClient,
  calendarIds: string[],
  options: DestinationEventReadOptions,
): Promise<RulesBySourceCalendarId> => {
  if (options.rulesBySourceCalendarId) {
    return Promise.resolve(options.rulesBySourceCalendarId);
  }
  if (options.destinationCalendarId) {
    return getSyncRulesForDestination(database, options.destinationCalendarId, calendarIds);
  }
  return Promise.resolve(new Map());
};

const getMappedSourceCalendarIds = async (
  database: BunSQLClient,
  destinationCalendarId: string,
): Promise<string[]> => {
  const mappings = await database
    .select({ sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId));

  return mappings.map((mapping) => mapping.sourceCalendarId);
};

const getEventsForCalendarsWithDiagnostics = async (
  database: BunSQLClient,
  calendarIds: string[],
  syncWindow: SyncWindow,
  options: DestinationEventReadOptions = {},
): Promise<DestinationEventReadResult> => {
  if (calendarIds.length === EMPTY_SOURCES_COUNT) {
    return {
      diagnostics: EMPTY_DESTINATION_EVENT_READ_DIAGNOSTICS,
      events: [],
    };
  }

  const rulesBySourceCalendarId = await resolveRulesBySourceCalendarId(database, calendarIds, options);
  const results = await database
    .select({
      calendarId: eventStatesTable.calendarId,
      calendarName: calendarsTable.name,
      calendarUrl: calendarsTable.url,
      availability: eventStatesTable.availability,
      description: eventStatesTable.description,
      endTime: eventStatesTable.endTime,
      exceptionDates: eventStatesTable.exceptionDates,
      id: eventStatesTable.id,
      isAllDay: eventStatesTable.isAllDay,
      location: eventStatesTable.location,
      recurrenceRule: eventStatesTable.recurrenceRule,
      recurrenceId: eventStatesTable.recurrenceId,
      sourceEventType: eventStatesTable.sourceEventType,
      sourceEventUid: eventStatesTable.sourceEventUid,
      startTime: eventStatesTable.startTime,
      startTimeZone: eventStatesTable.startTimeZone,
      title: eventStatesTable.title,
    })
    .from(eventStatesTable)
    .innerJoin(calendarsTable, eq(eventStatesTable.calendarId, calendarsTable.id))
    .where(
      and(
        inArray(eventStatesTable.calendarId, calendarIds),
        // Deliberately a superset of the real lower bound; the shared in-memory predicate decides.
        or(
          gte(eventStatesTable.endTime, syncWindow.timeMin),
          gte(eventStatesTable.startTime, syncWindow.timeMin),
          isNotNull(eventStatesTable.recurrenceRule),
          isNotNull(eventStatesTable.recurrenceId),
        ),
      ),
    )
    .orderBy(asc(eventStatesTable.startTime));

  const syncableEvents: SyncableEvent[] = [];
  let excludedBySyncPolicyCount = 0;
  let missingSourceEventUidCount = 0;
  let outsideReconciliationWindowCount = 0;
  let skippedByRuleCount = 0;
  let unmatchedByRuleCount = 0;

  for (const result of results) {
    if (result.sourceEventUid === null) {
      missingSourceEventUidCount += 1;
      continue;
    }
    const projection = projectSyncableEvent(
      result,
      rulesBySourceCalendarId.get(result.calendarId) ?? [],
    );
    if (projection.outcome === "working_location") {
      excludedBySyncPolicyCount += 1;
      continue;
    }
    if (projection.outcome === "unmatched") {
      unmatchedByRuleCount += 1;
      continue;
    }
    if (projection.outcome === "skipped") {
      skippedByRuleCount += 1;
      continue;
    }

    const recurrence = parseStoredRecurrenceForMaterialization({
      eventId: result.id,
      exceptionDates: result.exceptionDates,
      recurrenceId: result.recurrenceId,
      recurrenceRule: result.recurrenceRule,
    });

    if (
      !isEventInDestinationReconciliationWindow(result, syncWindow.timeMin)
      && !recurrence.recurrenceId
      && !recurrence.recurrenceRule
    ) {
      outsideReconciliationWindowCount += 1;
      continue;
    }

    syncableEvents.push({
      calendarId: result.calendarId,
      calendarName: result.calendarName,
      calendarUrl: result.calendarUrl,
      availability: parseAvailability(result.availability),
      description: projection.description,
      endTime: result.endTime,
      eventStateId: result.id,
      id: result.id,
      isAllDay: orAbsentBoolean(result.isAllDay),
      isPrivate: projection.isPrivate,
      location: projection.location,
      ...recurrence,
      sourceEventUid: result.sourceEventUid,
      startTime: result.startTime,
      startTimeZone: orAbsent(result.startTimeZone),
      summary: projection.summary,
    });
  }

  /*
   * A series can exceed the occurrence budget for a window the user just widened.
   * Skipping it keeps the destination syncing; failing here would back off the whole
   * calendar over one series, and ingestion already withholds these from new writes.
   */
  const overBudgetSourceEventStateIds: string[] = [];
  const overBudgetSourceEventUids: string[] = [];
  const events = materializeRecurrenceEvents(syncableEvents, {
    end: syncWindow.timeMax,
    start: syncWindow.timeMin,
  }, {
    onSeriesOverBudget: (error) => {
      overBudgetSourceEventUids.push(error.sourceEventUid);
      overBudgetSourceEventStateIds.push(error.eventStateId ?? error.eventId);
    },
  });

  const emptyTimeRangeCount = events.filter((event) => isEmptyTimeRange(event)).length;
  const invertedTimeRangeCount = events.filter((event) => isInvertedTimeRange(event)).length;

  return {
    diagnostics: {
      candidateEventStateCount: results.length,
      emptyTimeRangeCount,
      excludedBySyncPolicyCount,
      invertedTimeRangeCount,
      materializedEventCount: events.length,
      missingSourceEventUidCount,
      outsideReconciliationWindowCount,
      overBudgetSourceEventStateIds,
      overBudgetSourceEventUids,
      skippedByRuleCount,
      syncableEventCount: syncableEvents.length,
      unmatchedByRuleCount,
    },
    events,
  };
};

const getEventsForDestination = async (
  database: BunSQLClient,
  destinationCalendarId: string,
  syncWindow: SyncWindow,
): Promise<MaterializedSyncableEvent[]> => {
  const sourceCalendarIds = await getMappedSourceCalendarIds(database, destinationCalendarId);

  if (sourceCalendarIds.length === EMPTY_SOURCES_COUNT) {
    return [];
  }

  const result = await getEventsForCalendarsWithDiagnostics(
    database,
    sourceCalendarIds,
    syncWindow,
    { destinationCalendarId },
  );
  return result.events;
};

export {
  getEventsForCalendarsWithDiagnostics,
  getEventsForDestination,
  getMappedSourceCalendarIds,
  getSyncRulesForDestination,
  isEventInDestinationReconciliationWindow,
  projectSyncableEvent,
  shouldExcludeSyncEvent,
};
export type {
  DestinationEventReadDiagnostics,
  DestinationEventReadOptions,
  DestinationEventReadResult,
  DestinationSyncRule,
  RulesBySourceCalendarId,
  SyncableEventProjection,
};
