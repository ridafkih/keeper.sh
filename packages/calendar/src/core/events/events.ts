import {
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
  syncsTable,
} from "@keeper.sh/database/schema";
import { applyRuleActions, compileSyncRules, findMatchingRule, toShareAs } from "@keeper.sh/data-schemas";
import type { CompiledSyncRule, RuleEventFacts } from "@keeper.sh/data-schemas";
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

interface SourceProjectionOutcome {
  copied: number;
  skipped: number;
  skippedBy: Record<string, { count: number; name: string }>;
}

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
  sourceOutcomes: Record<string, SourceProjectionOutcome>;
  syncableEventCount: number;
  unmatchedByRuleCount: number;
}

type DestinationSyncRule = CompiledSyncRule;
type RulesBySourceCalendarId = ReadonlyMap<string, DestinationSyncRule[]>;

interface DestinationEventReadOptions {
  destinationCalendarId: string;
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
  sourceOutcomes: {},
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
  if (
    value === "focusTime"
    || value === "outOfOffice"
    || value === "tentative"
    || value === "workingLocation"
  ) {
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

const isExcludedAvailability = (
  excludeAvailabilities: string[],
  sourceEventType: SourceEventType,
  availability: string | null,
): boolean => {
  const resolved = parseAvailability(availability) ?? "busy";
  if (sourceEventType !== "tentative") {
    return excludeAvailabilities.includes(resolved);
  }
  if (excludeAvailabilities.includes("tentative")) {
    return true;
  }
  return resolved === "free" && excludeAvailabilities.includes("free");
};

const lowercaseKeywords = (keywords: string[]): string[] =>
  keywords.map((keyword) => keyword.toLowerCase());

const titleContainsKeyword = (title: string | null, lowercasedKeywords: string[]): boolean => {
  if (!title || lowercasedKeywords.length === 0) {
    return false;
  }
  const normalizedTitle = title.toLowerCase();
  return lowercasedKeywords.some((keyword) => normalizedTitle.includes(keyword));
};

interface SyncExclusionInput {
  excludeAllDayEvents: boolean;
  excludeAvailabilities: string[];
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  excludeTitleKeywords: string[];
  availability: string | null;
  isAllDay: boolean | null;
  sourceEventType: string | null;
  title: string | null;
}

const matchesSyncExclusion = (
  event: Omit<SyncExclusionInput, "excludeTitleKeywords">,
  lowercasedTitleKeywords: string[],
): boolean => {
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
  if (isExcludedAvailability(event.excludeAvailabilities, sourceEventType, event.availability)) {
    return true;
  }
  if (titleContainsKeyword(event.title, lowercasedTitleKeywords)) {
    return true;
  }

  return false;
};

const shouldExcludeSyncEvent = (event: SyncExclusionInput): boolean =>
  matchesSyncExclusion(event, lowercaseKeywords(event.excludeTitleKeywords));

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
  | { outcome: "skipped"; ruleId: string }
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
    availability: parseAvailability(row.availability) ?? "busy",
    calendarName: row.calendarName,
    description: orAbsent(row.description),
    isAllDay: row.isAllDay === true,
    isFocusTime: sourceEventType === "focusTime",
    isOutOfOffice: sourceEventType === "outOfOffice",
    isTentative: sourceEventType === "tentative",
    location: orAbsent(row.location),
    title: row.title ?? DEFAULT_EVENT_NAME,
  };
  const rule = findMatchingRule(rules, facts);
  if (!rule) {
    return { outcome: "unmatched" };
  }
  const evaluation = applyRuleActions(rule.actions, facts);
  if (evaluation.skip) {
    return { outcome: "skipped", ruleId: rule.id };
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

  const pairs = await database
    .select({
      busyTitle: syncsTable.busyTitle,
      markPrivate: syncsTable.markPrivate,
      rules: syncsTable.rules,
      shareAs: syncsTable.shareAs,
      skipAllDay: syncsTable.skipAllDay,
      skipAvailabilities: syncsTable.skipAvailabilities,
      skipFocusTime: syncsTable.skipFocusTime,
      skipOutOfOffice: syncsTable.skipOutOfOffice,
      skipTitleKeywords: syncsTable.skipTitleKeywords,
      sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId,
      syncId: syncsTable.id,
    })
    .from(sourceDestinationMappingsTable)
    .innerJoin(syncsTable, eq(sourceDestinationMappingsTable.syncId, syncsTable.id))
    .where(
      and(
        eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
        inArray(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarIds),
      ),
    );

  const compiledBySyncId = new Map<string, DestinationSyncRule[]>();
  for (const pair of pairs) {
    const compiled = compiledBySyncId.get(pair.syncId) ?? compileSyncRules({ ...pair, shareAs: toShareAs(pair.shareAs) });
    compiledBySyncId.set(pair.syncId, compiled);
    rulesBySourceCalendarId.set(pair.sourceCalendarId, compiled);
  }
  return rulesBySourceCalendarId;
};

const getPausedSourceCalendarIds = async (
  database: BunSQLClient,
  destinationCalendarId: string,
): Promise<Set<string>> => {
  const pairs = await database
    .select({ sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId })
    .from(sourceDestinationMappingsTable)
    .innerJoin(syncsTable, eq(sourceDestinationMappingsTable.syncId, syncsTable.id))
    .where(
      and(
        eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
        eq(syncsTable.paused, true),
      ),
    );
  return new Set(pairs.map((pair) => pair.sourceCalendarId));
};

interface WithdrawnInstance {
  calendarId: string;
  recurrenceId: Date;
  sourceEventUid: string;
}

const getSeriesKey = (event: Pick<SyncableEvent, "calendarId" | "sourceEventUid">): string =>
  JSON.stringify([event.calendarId, event.sourceEventUid]);

// An edited instance still holds its slot in the series when a rule keeps it from copying, so the slot is excluded.
// Otherwise the series would fill it with its original, unedited occurrence.
const excludeWithdrawnInstances = (
  events: SyncableEvent[],
  withdrawn: readonly WithdrawnInstance[],
): SyncableEvent[] => {
  if (withdrawn.length === 0) {
    return events;
  }
  const slotsBySeries = new Map<string, Date[]>();
  for (const instance of withdrawn) {
    const seriesKey = getSeriesKey(instance);
    slotsBySeries.set(seriesKey, [...(slotsBySeries.get(seriesKey) ?? []), instance.recurrenceId]);
  }
  return events.map((event) => {
    if (!event.recurrenceRule || event.recurrenceId) {
      return event;
    }
    const slots = slotsBySeries.get(getSeriesKey(event));
    if (!slots) {
      return event;
    }
    return { ...event, exceptionDates: [...(event.exceptionDates ?? []), ...slots] };
  });
};

const createSourceOutcome = (): SourceProjectionOutcome => ({ copied: 0, skipped: 0, skippedBy: {} });

const recordSkip = (
  outcomes: Record<string, SourceProjectionOutcome>,
  sourceCalendarId: string,
  rule: Pick<DestinationSyncRule, "id" | "name"> | undefined,
): void => {
  const outcome = outcomes[sourceCalendarId] ?? createSourceOutcome();
  outcome.skipped += 1;
  if (rule) {
    const tally = outcome.skippedBy[rule.id] ?? { count: 0, name: rule.name };
    tally.count += 1;
    outcome.skippedBy[rule.id] = tally;
  }
  outcomes[sourceCalendarId] = outcome;
};

const recordCopies = (
  outcomes: Record<string, SourceProjectionOutcome>,
  events: readonly Pick<MaterializedSyncableEvent, "calendarId">[],
): void => {
  for (const event of events) {
    const outcome = outcomes[event.calendarId] ?? createSourceOutcome();
    outcome.copied += 1;
    outcomes[event.calendarId] = outcome;
  }
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

interface DestinationEventRow extends SyncableEventProjectionRow {
  calendarId: string;
  calendarUrl: string | null;
  endTime: Date;
  exceptionDates: string | null;
  id: string;
  recurrenceId: Date | null;
  recurrenceRule: string | null;
  sourceEventUid: string | null;
  startTime: Date;
  startTimeZone: string | null;
}

interface SyncableEventContent {
  description?: string;
  isPrivate?: true;
  location?: string;
  summary: string;
}

const toSyncableEvent = (
  row: DestinationEventRow & { sourceEventUid: string },
  recurrence: ReturnType<typeof parseStoredRecurrenceForMaterialization>,
  content: SyncableEventContent,
): SyncableEvent => ({
  calendarId: row.calendarId,
  calendarName: row.calendarName,
  calendarUrl: row.calendarUrl,
  availability: parseAvailability(row.availability),
  description: content.description,
  endTime: row.endTime,
  eventStateId: row.id,
  id: row.id,
  isAllDay: orAbsentBoolean(row.isAllDay),
  isPrivate: content.isPrivate,
  location: content.location,
  ...recurrence,
  sourceEventUid: row.sourceEventUid,
  startTime: row.startTime,
  startTimeZone: orAbsent(row.startTimeZone),
  summary: content.summary,
});

interface SkippedSourceEvent {
  calendarId: string;
  rule: DestinationSyncRule | undefined;
}

const ignoreOverBudgetSeries = (): null => null;

// Skips are counted in the same units as copies: occurrences inside the window, with the copied edits still holding their slots.
const recordSkippedOccurrences = (
  outcomes: Record<string, SourceProjectionOutcome>,
  skippedEvents: SyncableEvent[],
  skippedById: ReadonlyMap<string, SkippedSourceEvent>,
  copiedInstances: readonly SyncableEvent[],
  syncWindow: SyncWindow,
): void => {
  if (skippedEvents.length === 0) {
    return;
  }
  const occurrences = materializeRecurrenceEvents([...skippedEvents, ...copiedInstances], {
    end: syncWindow.timeMax,
    start: syncWindow.timeMin,
  }, { onSeriesOverBudget: ignoreOverBudgetSeries });
  for (const occurrence of occurrences) {
    const skipped = skippedById.get(occurrence.eventStateId ?? occurrence.id);
    if (skipped) {
      recordSkip(outcomes, skipped.calendarId, skipped.rule);
    }
  }
};

const projectDestinationEvents = (
  rows: readonly DestinationEventRow[],
  rulesBySourceCalendarId: RulesBySourceCalendarId,
  syncWindow: SyncWindow,
): DestinationEventReadResult => {
  const syncableEvents: SyncableEvent[] = [];
  const skippedEvents: SyncableEvent[] = [];
  const skippedById = new Map<string, SkippedSourceEvent>();
  const copiedInstances: SyncableEvent[] = [];
  let excludedBySyncPolicyCount = 0;
  let missingSourceEventUidCount = 0;
  let outsideReconciliationWindowCount = 0;
  let skippedByRuleCount = 0;
  let unmatchedByRuleCount = 0;
  const sourceOutcomes: Record<string, SourceProjectionOutcome> = {};
  const withdrawnInstances: WithdrawnInstance[] = [];

  for (const row of rows) {
    const { sourceEventUid } = row;
    if (sourceEventUid === null) {
      missingSourceEventUidCount += 1;
      continue;
    }
    const sourceRules = rulesBySourceCalendarId.get(row.calendarId) ?? [];
    const projection = projectSyncableEvent(row, sourceRules);
    if (projection.outcome !== "copy" && row.recurrenceId) {
      withdrawnInstances.push({ calendarId: row.calendarId, recurrenceId: row.recurrenceId, sourceEventUid });
    }
    if (projection.outcome === "working_location") {
      excludedBySyncPolicyCount += 1;
      continue;
    }
    if (projection.outcome === "unmatched") {
      unmatchedByRuleCount += 1;
      continue;
    }

    const recurrence = parseStoredRecurrenceForMaterialization({
      eventId: row.id,
      exceptionDates: row.exceptionDates,
      recurrenceId: row.recurrenceId,
      recurrenceRule: row.recurrenceRule,
    });

    if (
      !isEventInDestinationReconciliationWindow(row, syncWindow.timeMin)
      && !recurrence.recurrenceId
      && !recurrence.recurrenceRule
    ) {
      outsideReconciliationWindowCount += 1;
      continue;
    }

    const sourceRow = { ...row, sourceEventUid };
    if (projection.outcome === "skipped") {
      skippedByRuleCount += 1;
      skippedEvents.push(toSyncableEvent(sourceRow, recurrence, { summary: "" }));
      skippedById.set(row.id, {
        calendarId: row.calendarId,
        rule: sourceRules.find((rule) => rule.id === projection.ruleId),
      });
      continue;
    }

    const event = toSyncableEvent(sourceRow, recurrence, projection);
    if (event.recurrenceId) {
      copiedInstances.push(event);
    }
    syncableEvents.push(event);
  }

  /*
   * A series can exceed the occurrence budget for a window the user just widened.
   * Skipping it keeps the destination syncing; failing here would back off the whole
   * calendar over one series, and ingestion already withholds these from new writes.
   */
  const overBudgetSourceEventStateIds: string[] = [];
  const overBudgetSourceEventUids: string[] = [];
  const events = materializeRecurrenceEvents(excludeWithdrawnInstances(syncableEvents, withdrawnInstances), {
    end: syncWindow.timeMax,
    start: syncWindow.timeMin,
  }, {
    onSeriesOverBudget: (error) => {
      overBudgetSourceEventUids.push(error.sourceEventUid);
      overBudgetSourceEventStateIds.push(error.eventStateId ?? error.eventId);
    },
  });

  recordCopies(sourceOutcomes, events);
  recordSkippedOccurrences(
    sourceOutcomes,
    excludeWithdrawnInstances(skippedEvents, withdrawnInstances),
    skippedById,
    copiedInstances,
    syncWindow,
  );
  const emptyTimeRangeCount = events.filter((event) => isEmptyTimeRange(event)).length;
  const invertedTimeRangeCount = events.filter((event) => isInvertedTimeRange(event)).length;

  return {
    diagnostics: {
      candidateEventStateCount: rows.length,
      emptyTimeRangeCount,
      excludedBySyncPolicyCount,
      invertedTimeRangeCount,
      materializedEventCount: events.length,
      missingSourceEventUidCount,
      outsideReconciliationWindowCount,
      overBudgetSourceEventStateIds,
      overBudgetSourceEventUids,
      skippedByRuleCount,
      sourceOutcomes,
      syncableEventCount: syncableEvents.length,
      unmatchedByRuleCount,
    },
    events,
  };
};

const getEventsForCalendarsWithDiagnostics = async (
  database: BunSQLClient,
  calendarIds: string[],
  syncWindow: SyncWindow,
  options: DestinationEventReadOptions,
): Promise<DestinationEventReadResult> => {
  if (calendarIds.length === EMPTY_SOURCES_COUNT) {
    return {
      diagnostics: EMPTY_DESTINATION_EVENT_READ_DIAGNOSTICS,
      events: [],
    };
  }

  const rulesBySourceCalendarId = await getSyncRulesForDestination(
    database,
    options.destinationCalendarId,
    calendarIds,
  );
  const rows = await database
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

  return projectDestinationEvents(rows, rulesBySourceCalendarId, syncWindow);
};

export {
  excludeWithdrawnInstances,
  getEventsForCalendarsWithDiagnostics,
  getMappedSourceCalendarIds,
  getPausedSourceCalendarIds,
  getSyncRulesForDestination,
  isEventInDestinationReconciliationWindow,
  projectDestinationEvents,
  projectSyncableEvent,
  shouldExcludeSyncEvent,
};
export type {
  DestinationEventReadDiagnostics,
  DestinationEventReadOptions,
  DestinationEventReadResult,
  DestinationEventRow,
  DestinationSyncRule,
  SourceProjectionOutcome,
  SyncableEventProjection,
};
