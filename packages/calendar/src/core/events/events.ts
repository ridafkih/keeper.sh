import { calendarsTable, eventStatesTable } from "@keeper.sh/database/schema";
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
import {
  getDestinationSourceChain,
  getEffectiveSourcesForDestination,
} from "../sync/effective-sources";
import { parseStoredRecurrenceForMaterialization } from "./stored-recurrence";
import { materializeRecurrenceEvents } from "./recurrence-materializer";
import { appendMeetingLink } from "./meeting-link";
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

interface EffectiveSyncRules extends SyncRules {
  lowercasedTitleKeywords: string[];
}

interface InheritedRuleHop {
  calendarName: string;
  rules: EffectiveSyncRules;
}

interface SourceRulePath {
  inheritedHops: InheritedRuleHop[];
  overrides: SyncRuleOverrides | null;
}

type SourceRulePathsBySourceCalendar = Map<string, SourceRulePath>;

const DIRECT_SOURCE_RULE_PATH: SourceRulePath = { inheritedHops: [], overrides: null };

const toEffectiveSyncRules = (rules: SyncRules): EffectiveSyncRules => ({
  ...rules,
  lowercasedTitleKeywords: lowercaseKeywords(rules.excludeTitleKeywords),
});

const createMappingKey = (sourceCalendarId: string, destinationCalendarId: string): string =>
  `${sourceCalendarId}:${destinationCalendarId}`;

interface ViaCalendar {
  name: string;
  rules: SyncRules;
}

const getViaCalendars = async (
  database: BunSQLClient,
  calendarIds: string[],
): Promise<Map<string, ViaCalendar>> => {
  if (calendarIds.length === EMPTY_SOURCES_COUNT) {
    return new Map();
  }

  const calendars = await database
    .select({
      customEventName: calendarsTable.customEventName,
      disableEventReminders: calendarsTable.disableEventReminders,
      excludeAllDayEvents: calendarsTable.excludeAllDayEvents,
      excludeAvailabilities: calendarsTable.excludeAvailabilities,
      excludeEventDescription: calendarsTable.excludeEventDescription,
      excludeEventLocation: calendarsTable.excludeEventLocation,
      excludeEventMeetingLink: calendarsTable.excludeEventMeetingLink,
      excludeEventName: calendarsTable.excludeEventName,
      excludeFocusTime: calendarsTable.excludeFocusTime,
      excludeOutOfOffice: calendarsTable.excludeOutOfOffice,
      excludeTitleKeywords: calendarsTable.excludeTitleKeywords,
      id: calendarsTable.id,
      markEventsAsPrivate: calendarsTable.markEventsAsPrivate,
      name: calendarsTable.name,
    })
    .from(calendarsTable)
    .where(inArray(calendarsTable.id, calendarIds));

  return new Map(calendars.map(({ id, name, ...rules }) => [id, { name, rules }]));
};

const getSourceRulePathsForDestination = async (
  database: BunSQLClient,
  destinationCalendarId: string,
): Promise<SourceRulePathsBySourceCalendar> => {
  const { mappings, sources } = await getDestinationSourceChain(database, destinationCalendarId);
  const mappingsByKey = new Map(mappings.map((mapping) => [
    createMappingKey(mapping.sourceCalendarId, mapping.destinationCalendarId),
    mapping,
  ]));
  const viaCalendars = await getViaCalendars(
    database,
    [...new Set(sources.flatMap((source) => source.viaCalendarIds))],
  );

  return new Map(sources.map((source) => {
    const hopCalendarIds = [...source.viaCalendarIds, destinationCalendarId];
    const [firstHopCalendarId = destinationCalendarId] = hopCalendarIds;
    const inheritedHops = source.viaCalendarIds.flatMap((viaCalendarId, index) => {
      const viaCalendar = viaCalendars.get(viaCalendarId);
      const nextCalendarId = hopCalendarIds[index + 1];
      if (!viaCalendar || !nextCalendarId) {
        return [];
      }
      return [{
        calendarName: viaCalendar.name,
        rules: toEffectiveSyncRules(resolveSyncRules(
          viaCalendar.rules,
          mappingsByKey.get(createMappingKey(viaCalendarId, nextCalendarId)),
        )),
      }];
    });
    return [source.sourceCalendarId, {
      inheritedHops,
      overrides: mappingsByKey.get(
        createMappingKey(source.sourceCalendarId, firstHopCalendarId),
      ) ?? null,
    }];
  }));
};

const createSourceRulesResolver = (rulePaths: SourceRulePathsBySourceCalendar) => {
  const rulesByCalendar = new Map<string, EffectiveSyncRules>();

  return (calendarId: string, sourceRules: SyncRules): EffectiveSyncRules => {
    const cached = rulesByCalendar.get(calendarId);
    if (cached) {
      return cached;
    }
    const effective = toEffectiveSyncRules(
      resolveSyncRules(sourceRules, rulePaths.get(calendarId)?.overrides),
    );
    rulesByCalendar.set(calendarId, effective);
    return effective;
  };
};

interface EventPresentation {
  description: string | undefined;
  isPrivate: true | undefined;
  location: string | undefined;
  remindersDisabled: true | undefined;
  summary: string;
}

interface PresentedEvent {
  availability: string | null;
  description: string | null;
  isAllDay: boolean | null;
  location: string | null;
  meetingLink: string | null;
  sourceEventType: string | null;
  title: string | null;
}

const presentDescription = (
  event: PresentedEvent,
  rules: EffectiveSyncRules,
): string | undefined => {
  const description = excludeOrAbsent(rules.excludeEventDescription, event.description);
  if (rules.excludeEventMeetingLink || !event.meetingLink) {
    return description;
  }
  return appendMeetingLink(description, event.meetingLink);
};

const presentEvent = (
  event: PresentedEvent,
  calendarName: string,
  rules: EffectiveSyncRules,
): EventPresentation | null => {
  if (matchesSyncExclusion(
    {
      availability: event.availability,
      excludeAllDayEvents: rules.excludeAllDayEvents,
      excludeAvailabilities: rules.excludeAvailabilities,
      excludeFocusTime: rules.excludeFocusTime,
      excludeOutOfOffice: rules.excludeOutOfOffice,
      isAllDay: event.isAllDay,
      sourceEventType: event.sourceEventType,
      title: event.title,
    },
    rules.lowercasedTitleKeywords,
  )) {
    return null;
  }

  const eventName = event.title ?? DEFAULT_EVENT_NAME;
  let summary = eventName;
  if (rules.excludeEventName) {
    summary = resolveEventNameTemplate(rules.customEventName || DEFAULT_EVENT_NAME_TEMPLATE, {
      calendar_name: calendarName,
      event_name: eventName,
    });
  }

  return {
    description: presentDescription(event, rules),
    isPrivate: trueOrAbsent(rules.markEventsAsPrivate),
    location: excludeOrAbsent(rules.excludeEventLocation, event.location),
    remindersDisabled: trueOrAbsent(rules.disableEventReminders),
    summary,
  };
};

const presentEventThroughHops = (
  event: PresentedEvent,
  presentation: EventPresentation,
  hops: InheritedRuleHop[],
): EventPresentation | null => {
  let current: EventPresentation | null = presentation;
  for (const hop of hops) {
    if (!current) {
      return null;
    }
    const shown: EventPresentation | null = presentEvent(
      {
        ...event,
        description: current.description ?? null,
        location: current.location ?? null,
        meetingLink: null,
        title: current.summary,
      },
      hop.calendarName,
      hop.rules,
    );
    current = shown && {
      ...shown,
      isPrivate: current.isPrivate ?? shown.isPrivate,
      remindersDisabled: current.remindersDisabled ?? shown.remindersDisabled,
    };
  }
  return current;
};

interface DestinationEventReadOptions {
  destinationCalendarId?: string;
}

const readSourceRulePaths = (
  database: BunSQLClient,
  options: DestinationEventReadOptions,
): Promise<SourceRulePathsBySourceCalendar> => {
  if (!options.destinationCalendarId) {
    return Promise.resolve(new Map());
  }
  return getSourceRulePathsForDestination(database, options.destinationCalendarId);
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

  const rulePaths = await readSourceRulePaths(database, options);
  const resolveSourceRules = createSourceRulesResolver(rulePaths);

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
      excludeEventMeetingLink: calendarsTable.excludeEventMeetingLink,
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
      meetingLink: eventStatesTable.meetingLink,
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
    const rulePath = rulePaths.get(result.calendarId) ?? DIRECT_SOURCE_RULE_PATH;
    const sourcePresentation = presentEvent(
      result,
      result.calendarName,
      resolveSourceRules(result.calendarId, result),
    );
    const presentation = sourcePresentation
      && presentEventThroughHops(result, sourcePresentation, rulePath.inheritedHops);
    if (!presentation) {
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

    syncableEvents.push({
      calendarId: result.calendarId,
      calendarName: result.calendarName,
      calendarUrl: result.calendarUrl,
      availability: parseAvailability(result.availability),
      description: presentation.description,
      endTime: result.endTime,
      eventStateId: result.id,
      id: result.id,
      isAllDay: orAbsentBoolean(result.isAllDay),
      isPrivate: presentation.isPrivate,
      remindersDisabled: presentation.remindersDisabled,
      location: presentation.location,
      ...recurrence,
      sourceEventUid: result.sourceEventUid,
      startTime: result.startTime,
      startTimeZone: orAbsent(result.startTimeZone),
      summary: presentation.summary,
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
  const sources = await getEffectiveSourcesForDestination(database, destinationCalendarId);
  const sourceCalendarIds = sources.map((source) => source.sourceCalendarId);

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
  isEventAvailability,
  getEventsForCalendars,
  getEventsForCalendarsWithDiagnostics,
  getEventsForDestination,
  isEventInDestinationReconciliationWindow,
  shouldExcludeSyncEvent,
};
export type { DestinationEventReadDiagnostics, DestinationEventReadResult };
