import {
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { resolveSyncRules } from "@keeper.sh/data-schemas";
import type { SyncRuleOverrides, SyncRules } from "@keeper.sh/data-schemas";
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
  syncableEventCount: number;
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
  syncableEventCount: 0,
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

const excludeOrAbsent = <TValue>(exclude: boolean, value: TValue | null): TValue | undefined => {
  if (exclude) {
    return;
  }
  return orAbsent(value);
};

const orAbsentBoolean = (value: boolean | null): boolean | undefined => {
  if (value === null) {
    return;
  }
  return value;
};

const trueOrAbsent = (value: boolean): true | undefined => {
  if (!value) {
    return;
  }
  return true;
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

const TEMPLATE_TOKEN_PATTERN = /\{\{(\w+)\}\}/g;
const DEFAULT_EVENT_NAME = "Busy";
const DEFAULT_EVENT_NAME_TEMPLATE = "{{calendar_name}}";
const resolveEventNameTemplate = (
  template: string,
  variables: Record<string, string>,
): string => {
  const resolved = template.replace(
    TEMPLATE_TOKEN_PATTERN,
    (token, variableName) => variables[variableName] ?? token,
  ).trim();

  return resolved || variables.calendar_name || DEFAULT_EVENT_NAME;
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

type SyncRuleOverridesBySourceCalendar = Map<string, SyncRuleOverrides>;

const getSyncRuleOverridesForDestination = async (
  database: BunSQLClient,
  destinationCalendarId: string,
  sourceCalendarIds: string[],
): Promise<SyncRuleOverridesBySourceCalendar> => {
  if (sourceCalendarIds.length === EMPTY_SOURCES_COUNT) {
    return new Map();
  }

  const mappings = await database
    .select({
      customEventName: sourceDestinationMappingsTable.customEventName,
      disableEventReminders: sourceDestinationMappingsTable.disableEventReminders,
      excludeAllDayEvents: sourceDestinationMappingsTable.excludeAllDayEvents,
      excludeAvailabilities: sourceDestinationMappingsTable.excludeAvailabilities,
      excludeEventDescription: sourceDestinationMappingsTable.excludeEventDescription,
      excludeEventLocation: sourceDestinationMappingsTable.excludeEventLocation,
      excludeEventName: sourceDestinationMappingsTable.excludeEventName,
      excludeFocusTime: sourceDestinationMappingsTable.excludeFocusTime,
      excludeOutOfOffice: sourceDestinationMappingsTable.excludeOutOfOffice,
      excludeTitleKeywords: sourceDestinationMappingsTable.excludeTitleKeywords,
      markEventsAsPrivate: sourceDestinationMappingsTable.markEventsAsPrivate,
      sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId,
    })
    .from(sourceDestinationMappingsTable)
    .where(
      and(
        eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
        inArray(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarIds),
      ),
    );

  return new Map(
    mappings.map(({ sourceCalendarId, ...overrides }) => [sourceCalendarId, overrides]),
  );
};

interface EffectiveSyncRules extends SyncRules {
  lowercasedTitleKeywords: string[];
}

const createEffectiveSyncRulesResolver = (
  overridesBySourceCalendar: SyncRuleOverridesBySourceCalendar,
) => {
  const rulesByCalendar = new Map<string, EffectiveSyncRules>();

  return (calendarId: string, sourceRules: SyncRules): EffectiveSyncRules => {
    const cached = rulesByCalendar.get(calendarId);
    if (cached) {
      return cached;
    }
    const resolved = resolveSyncRules(sourceRules, overridesBySourceCalendar.get(calendarId));
    const effective = {
      ...resolved,
      lowercasedTitleKeywords: lowercaseKeywords(resolved.excludeTitleKeywords),
    };
    rulesByCalendar.set(calendarId, effective);
    return effective;
  };
};

interface DestinationEventReadOptions {
  destinationCalendarId?: string;
}

const readSyncRuleOverrides = (
  database: BunSQLClient,
  calendarIds: string[],
  options: DestinationEventReadOptions,
): Promise<SyncRuleOverridesBySourceCalendar> => {
  if (!options.destinationCalendarId) {
    return Promise.resolve(new Map());
  }
  return getSyncRuleOverridesForDestination(database, options.destinationCalendarId, calendarIds);
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

  const resolveEffectiveSyncRules = createEffectiveSyncRulesResolver(
    await readSyncRuleOverrides(database, calendarIds, options),
  );

  const results = await database
    .select({
      calendarId: eventStatesTable.calendarId,
      calendarName: calendarsTable.name,
      calendarUrl: calendarsTable.url,
      customEventName: calendarsTable.customEventName,
      excludeAllDayEvents: calendarsTable.excludeAllDayEvents,
      excludeAvailabilities: calendarsTable.excludeAvailabilities,
      excludeEventDescription: calendarsTable.excludeEventDescription,
      excludeEventLocation: calendarsTable.excludeEventLocation,
      excludeEventName: calendarsTable.excludeEventName,
      excludeFocusTime: calendarsTable.excludeFocusTime,
      excludeOutOfOffice: calendarsTable.excludeOutOfOffice,
      excludeTitleKeywords: calendarsTable.excludeTitleKeywords,
      markEventsAsPrivate: calendarsTable.markEventsAsPrivate,
      disableEventReminders: calendarsTable.disableEventReminders,
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
  const excludedOverrides: Pick<SyncableEvent, "calendarId" | "recurrenceId" | "sourceEventUid">[] = [];
  let excludedBySyncPolicyCount = 0;
  let missingSourceEventUidCount = 0;
  let outsideReconciliationWindowCount = 0;

  for (const result of results) {
    if (result.sourceEventUid === null) {
      missingSourceEventUidCount += 1;
      continue;
    }
    const rules = resolveEffectiveSyncRules(result.calendarId, result);
    if (matchesSyncExclusion(
      {
        availability: result.availability,
        excludeAllDayEvents: rules.excludeAllDayEvents,
        excludeAvailabilities: rules.excludeAvailabilities,
        excludeFocusTime: rules.excludeFocusTime,
        excludeOutOfOffice: rules.excludeOutOfOffice,
        isAllDay: result.isAllDay,
        sourceEventType: result.sourceEventType,
        title: result.title,
      },
      rules.lowercasedTitleKeywords,
    )) {
      excludedBySyncPolicyCount += 1;
      if (result.recurrenceId) {
        excludedOverrides.push({
          calendarId: result.calendarId,
          recurrenceId: result.recurrenceId,
          sourceEventUid: result.sourceEventUid,
        });
      }
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

    const eventName = result.title ?? DEFAULT_EVENT_NAME;
    const {calendarName} = result;
    const template = rules.customEventName || DEFAULT_EVENT_NAME_TEMPLATE;

    let summary = eventName;
    if (rules.excludeEventName) {
      summary = resolveEventNameTemplate(template, {
        calendar_name: calendarName,
        event_name: eventName,
      });
    }

    syncableEvents.push({
      calendarId: result.calendarId,
      calendarName: result.calendarName,
      calendarUrl: result.calendarUrl,
      availability: parseAvailability(result.availability),
      description: excludeOrAbsent(rules.excludeEventDescription, result.description),
      endTime: result.endTime,
      eventStateId: result.id,
      id: result.id,
      isAllDay: orAbsentBoolean(result.isAllDay),
      isPrivate: trueOrAbsent(rules.markEventsAsPrivate),
      remindersDisabled: trueOrAbsent(rules.disableEventReminders),
      location: excludeOrAbsent(rules.excludeEventLocation, result.location),
      ...recurrence,
      sourceEventUid: result.sourceEventUid,
      startTime: result.startTime,
      startTimeZone: orAbsent(result.startTimeZone),
      summary,
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
    suppressedOverrides: excludedOverrides,
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
      syncableEventCount: syncableEvents.length,
    },
    events,
  };
};

const getEventsForCalendars = async (
  database: BunSQLClient,
  calendarIds: string[],
  syncWindow: SyncWindow,
): Promise<MaterializedSyncableEvent[]> => {
  const result = await getEventsForCalendarsWithDiagnostics(database, calendarIds, syncWindow);
  return result.events;
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
  getEventsForCalendars,
  getEventsForCalendarsWithDiagnostics,
  getEventsForDestination,
  getMappedSourceCalendarIds,
  isEventInDestinationReconciliationWindow,
  shouldExcludeSyncEvent,
};
export type { DestinationEventReadDiagnostics, DestinationEventReadResult };
