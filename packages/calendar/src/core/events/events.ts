import {
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, asc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import type { BunSQLClient } from "../database-client";
import type {
  MaterializedSyncableEvent,
  SourceEventType,
  SyncableEvent,
} from "../types";
import type { SyncWindow } from "../sync/sync-range";
import { TWO_WAY_DELETE_APPROVAL_TTL_MS } from "@keeper.sh/constants";
import { resolveWritableWriteBackMode } from "@keeper.sh/data-schemas";
import { parseAvailability } from "./availability";
import { DEFAULT_EVENT_NAME } from "./default-event-name";
import {
  isSourceSnapshotFresh,
  isWriteBackMode,
  resolveWriteBackPolicyState,
} from "../sync/write-back-policy";
import type { WriteBackPolicy } from "../sync/write-back-policy";
import { isWriteBackReach } from "../source/writer";
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
const TEMPLATE_TOKEN_PATTERN = /\{\{(\w+)\}\}/g;
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

const getWriteBackPoliciesForDestination = async (
  database: BunSQLClient,
  destinationCalendarId: string,
  now: Date = new Date(),
): Promise<Map<string, WriteBackPolicy>> => {
  const rows = await database
    .select({
      calendarType: calendarsTable.calendarType,
      capabilities: calendarsTable.capabilities,
      deleteConfirmationApprovedAt:
        sourceDestinationMappingsTable.deleteConfirmationApprovedAt,
      disabled: calendarsTable.disabled,
      excludeEventDescription: calendarsTable.excludeEventDescription,
      excludeEventLocation: calendarsTable.excludeEventLocation,
      excludeEventName: calendarsTable.excludeEventName,
      ingestLastSucceededAt: calendarsTable.ingestLastSucceededAt,
      writeBackReach: sourceDestinationMappingsTable.writeBackReach,
      sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId,
      writeBackMode: sourceDestinationMappingsTable.writeBackMode,
      writeBackState: sourceDestinationMappingsTable.writeBackState,
    })
    .from(sourceDestinationMappingsTable)
    .innerJoin(
      calendarsTable,
      eq(sourceDestinationMappingsTable.sourceCalendarId, calendarsTable.id),
    )
    .where(eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId));

  const policies = new Map<string, WriteBackPolicy>();
  for (const row of rows) {
    if (!isWriteBackMode(row.writeBackMode)) {
      throw new Error(
        `Source-destination mapping for ${row.sourceCalendarId} has an unknown write-back mode`,
      );
    }
    /*
     * Fatal for the same reason the mode is: a reach nobody can read is a permission nobody
     * can weigh, and guessing at one silently widens or narrows what a real calendar allows.
     */
    if (!isWriteBackReach(row.writeBackReach)) {
      throw new Error(
        `Source-destination mapping for ${row.sourceCalendarId} has an unknown write-back reach`,
      );
    }
    /*
     * Rediscovery rewrites a source's capabilities when the provider stops granting write
     * access, and nothing rewrites the mode the pair is carrying. The stored preference is
     * kept so it comes back with the access, but a calendar Keeper.sh may only read is
     * written to by nothing in the meantime.
     */
    const effectiveMode = resolveWritableWriteBackMode(row.writeBackMode, {
      calendarType: row.calendarType,
      capabilities: row.capabilities,
      disabled: row.disabled,
    });
    /*
     * A stale snapshot pauses the pair rather than turning it off. Turning it off hands
     * every mapping back to the one-way repair, which rebuilds the copies from the same
     * stale snapshot and discards whatever the user changed on them — the one outcome
     * worse than writing nothing. Pausing writes nothing and rebuilds nothing, and the
     * pair resumes on its own the moment the source is read again.
     */
    const state = resolveWriteBackPolicyState(effectiveMode, row.writeBackState, {
      approvedAt: row.deleteConfirmationApprovedAt,
      now,
      ttlMs: TWO_WAY_DELETE_APPROVAL_TTL_MS,
    });
    const staleSource = state.writeBackMode !== "off"
      && !isSourceSnapshotFresh(row, now);
    policies.set(row.sourceCalendarId, {
      destinationCalendarId,
      excludeEventDescription: row.excludeEventDescription,
      excludeEventLocation: row.excludeEventLocation,
      excludeEventName: row.excludeEventName,
      writeBackReach: row.writeBackReach,
      sourceCalendarId: row.sourceCalendarId,
      ...state,
      ...(staleSource && { deleteApproved: false, paused: true }),
    });
  }
  return policies;
};

const getEventsForCalendarsWithDiagnostics = async (
  database: BunSQLClient,
  calendarIds: string[],
  syncWindow: SyncWindow,
): Promise<DestinationEventReadResult> => {
  if (calendarIds.length === EMPTY_SOURCES_COUNT) {
    return {
      diagnostics: EMPTY_DESTINATION_EVENT_READ_DIAGNOSTICS,
      events: [],
    };
  }

  const results = await database
    .select({
      calendarId: eventStatesTable.calendarId,
      calendarName: calendarsTable.name,
      calendarUrl: calendarsTable.url,
      customEventName: calendarsTable.customEventName,
      excludeAllDayEvents: calendarsTable.excludeAllDayEvents,
      excludeEventDescription: calendarsTable.excludeEventDescription,
      excludeEventLocation: calendarsTable.excludeEventLocation,
      excludeEventName: calendarsTable.excludeEventName,
      excludeFocusTime: calendarsTable.excludeFocusTime,
      excludeOutOfOffice: calendarsTable.excludeOutOfOffice,
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

  for (const result of results) {
    if (result.sourceEventUid === null) {
      missingSourceEventUidCount += 1;
      continue;
    }
    if (shouldExcludeSyncEvent(result)) {
      excludedBySyncPolicyCount += 1;
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
    const template = result.customEventName || DEFAULT_EVENT_NAME_TEMPLATE;

    let summary = eventName;
    if (result.excludeEventName) {
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
      description: excludeOrAbsent(result.excludeEventDescription, result.description),
      endTime: result.endTime,
      eventStateId: result.id,
      id: result.id,
      isAllDay: orAbsentBoolean(result.isAllDay),
      location: excludeOrAbsent(result.excludeEventLocation, result.location),
      ...recurrence,
      sourceEventUid: result.sourceEventUid,
      sourceFields: {
        description: result.description,
        location: result.location,
        title: result.title,
      },
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

  return getEventsForCalendars(database, sourceCalendarIds, syncWindow);
};

export {
  DEFAULT_EVENT_NAME,
  getEventsForCalendars,
  getWriteBackPoliciesForDestination,
  getEventsForCalendarsWithDiagnostics,
  getEventsForDestination,
  getMappedSourceCalendarIds,
  isEventInDestinationReconciliationWindow,
  shouldExcludeSyncEvent,
};
export type { DestinationEventReadDiagnostics, DestinationEventReadResult };
