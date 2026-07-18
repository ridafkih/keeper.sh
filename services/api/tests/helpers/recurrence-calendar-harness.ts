import {
  buildEventStateInsertRow,
  buildSourceEventInstanceKey,
  ingestSource,
  parseStoredSourceEventStates,
  type IngestionResult,
  type SourceEvent,
  type StoredSourceEventState,
} from "@keeper.sh/calendar";
import { parseIcsCalendar, parseIcsEvents } from "@keeper.sh/calendar/ics";
import type { IcsEvent, IcsRecurrenceRule } from "ts-ics";

import { formatEventsAsIcal } from "../../src/utils/ical-format";
import type { CalendarEvent } from "../../src/utils/ical-format";

const CALENDAR_ID = "00000000-0000-4000-8000-000000000001";
const CALENDAR_NAME = "Recurrence contract";
const MILLISECONDS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const parseOptionalDate = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }
  return new Date(value);
};

interface PersistedEventState extends StoredSourceEventState {
  calendarId: string;
}

interface IngestStepResult {
  flushes: number;
  result: IngestionResult;
}

interface SemanticOccurrence {
  end: string;
  recurrenceId: string;
  start: string;
  summary: string | null;
}

interface ParsedKeeperCalendar {
  events: IcsEvent[];
  occurrences: SemanticOccurrence[];
}

type WeeklyMaster = IcsEvent & {
  end: { date: Date };
  recurrenceRule: IcsRecurrenceRule & { count: number };
  uid: string;
};

const isWeeklyMaster = (event: IcsEvent): event is WeeklyMaster =>
  Boolean(
    event.uid
    && event.end
    && event.recurrenceRule?.frequency === "WEEKLY"
    && typeof event.recurrenceRule.count === "number",
  );

const toSourceEvent = (
  event: ReturnType<typeof parseIcsEvents>[number],
): SourceEvent => ({
  availability: event.availability,
  description: event.description,
  endTime: event.endTime,
  exceptionDates: event.exceptionDates,
  isAllDay: event.isAllDay,
  location: event.location,
  recurrenceId: event.recurrenceId,
  recurrenceRule: event.recurrenceRule,
  startTime: event.startTime,
  startTimeZone: event.startTimeZone,
  title: event.title,
  uid: event.uid,
});

const parseSourceIcs = (ics: string): SourceEvent[] =>
  parseIcsEvents(parseIcsCalendar({ icsString: ics })).map((event) => toSourceEvent(event));

const toPersistedEventState = (
  id: string,
  row: ReturnType<typeof buildEventStateInsertRow>,
): PersistedEventState => ({
  availability: row.availability ?? null,
  calendarId: row.calendarId,
  description: row.description ?? null,
  endTime: row.endTime,
  exceptionDates: row.exceptionDates ?? null,
  id,
  isAllDay: row.isAllDay ?? null,
  location: row.location ?? null,
  recurrenceId: row.recurrenceId ?? null,
  recurrenceRule: row.recurrenceRule ?? null,
  sourceEventId: row.sourceEventId ?? null,
  sourceEventType: row.sourceEventType ?? null,
  sourceEventUid: row.sourceEventUid ?? null,
  startTime: row.startTime,
  startTimeZone: row.startTimeZone ?? null,
  title: row.title ?? null,
});

const persistenceIdentityMatches = (
  existing: PersistedEventState,
  incoming: ReturnType<typeof buildEventStateInsertRow>,
): boolean => {
  if (incoming.sourceEventId) {
    return existing.sourceEventId === incoming.sourceEventId;
  }

  if (incoming.recurrenceId) {
    return existing.sourceEventId === null
      && existing.sourceEventUid === incoming.sourceEventUid
      && existing.recurrenceId?.getTime() === incoming.recurrenceId.getTime();
  }

  if (incoming.recurrenceRule) {
    return existing.sourceEventId === null
      && existing.sourceEventUid === incoming.sourceEventUid
      && existing.recurrenceRule !== null;
  }

  return existing.sourceEventId === null
    && existing.sourceEventUid === incoming.sourceEventUid
    && existing.startTime.getTime() === incoming.startTime.getTime()
    && existing.endTime.getTime() === incoming.endTime.getTime();
};

const toCalendarEvent = (
  event: ReturnType<typeof parseStoredSourceEventStates>[number],
): CalendarEvent => ({
  availability: event.availability ?? null,
  calendarId: CALENDAR_ID,
  calendarName: CALENDAR_NAME,
  description: event.description ?? null,
  endTime: event.endTime,
  exceptionDates: event.exceptionDates,
  id: event.id,
  isAllDay: event.isAllDay ?? null,
  location: event.location ?? null,
  recurrenceId: event.recurrenceId,
  recurrenceRule: event.recurrenceRule,
  sourceEventUid: event.sourceEventUid,
  startTime: event.startTime,
  startTimeZone: event.startTimeZone,
  title: event.title ?? null,
});

const addWeeks = (date: Date, count: number): Date =>
  new Date(date.getTime() + count * MILLISECONDS_PER_WEEK);

const findWeeklyMaster = (events: IcsEvent[]): WeeklyMaster => {
  const masters = events.filter((event) => event.recurrenceRule);
  if (masters.length !== 1) {
    throw new Error(`Expected one recurring master, received ${masters.length}`);
  }

  const [master] = masters;
  if (!master?.uid || !master.end || !master.recurrenceRule) {
    throw new Error("Expected a complete recurring master");
  }
  if (master.recurrenceRule.frequency !== "WEEKLY") {
    throw new TypeError(`Unsupported test frequency: ${master.recurrenceRule.frequency}`);
  }
  if (typeof master.recurrenceRule.count !== "number") {
    throw new TypeError("The test oracle requires an explicit recurrence count");
  }
  if (!isWeeklyMaster(master)) {
    throw new TypeError("Expected a complete weekly master");
  }
  return master;
};

const collectOverrides = (events: IcsEvent[], master: IcsEvent): Map<string, IcsEvent> => {
  const overrides = new Map<string, IcsEvent>();
  for (const event of events) {
    if (event === master) {
      continue;
    }
    if (event.uid !== master.uid) {
      throw new Error("A recurring override did not reuse its master's UID");
    }

    const recurrenceId = event.recurrenceId?.value.date.toISOString();
    if (!recurrenceId) {
      throw new Error("A same-UID sibling was emitted without RECURRENCE-ID");
    }
    if (overrides.has(recurrenceId)) {
      throw new Error(`Duplicate override for ${recurrenceId}`);
    }
    overrides.set(recurrenceId, event);
  }
  return overrides;
};

/**
 * A deliberately small, test-only recurrence evaluator. It supports only the
 * WEEKLY + COUNT fixtures in the lifecycle contract. It does not call any
 * Keeper recurrence, identity, diff, or persistence helper, so the expected
 * occurrence list cannot agree merely because production reused the same bug.
 */
const materializeWeeklyCalendar = (events: IcsEvent[]): SemanticOccurrence[] => {
  if (events.length === 0) {
    return [];
  }

  const master = findWeeklyMaster(events);
  const interval = master.recurrenceRule.interval ?? 1;
  const duration = master.end.date.getTime() - master.start.date.getTime();
  const excluded = new Set(
    (master.exceptionDates ?? []).map((exception) => exception.date.toISOString()),
  );
  const overrides = collectOverrides(events, master);

  const occurrences: SemanticOccurrence[] = [];
  for (let index = 0; index < master.recurrenceRule.count; index += 1) {
    const scheduledStart = addWeeks(master.start.date, index * interval);
    const recurrenceId = scheduledStart.toISOString();
    const override = overrides.get(recurrenceId);

    if (override) {
      if (!override.end) {
        throw new Error(`Override ${recurrenceId} has no end`);
      }
      occurrences.push({
        end: override.end.date.toISOString(),
        recurrenceId,
        start: override.start.date.toISOString(),
        summary: override.summary ?? null,
      });
      overrides.delete(recurrenceId);
      continue;
    }

    if (excluded.has(recurrenceId)) {
      continue;
    }

    occurrences.push({
      end: new Date(scheduledStart.getTime() + duration).toISOString(),
      recurrenceId,
      start: scheduledStart.toISOString(),
      summary: master.summary ?? null,
    });
  }

  if (overrides.size > 0) {
    throw new Error(`Overrides reference missing instances: ${[...overrides.keys()].join(", ")}`);
  }

  return occurrences;
};

class RecurrenceCalendarHarness {
  private events: PersistedEventState[] = [];
  private nextId = 1;
  private flushCount = 0;

  public async ingestIcs(ics: string): Promise<IngestStepResult> {
    const events = parseSourceIcs(ics);
    const flushCountBefore = this.flushCount;
    const result = await ingestSource({
      calendarId: CALENDAR_ID,
      fetchEvents: () => Promise.resolve({ events }),
      flush: (changes) => {
        this.flushCount += 1;
        const deletedIds = new Set(changes.deletes);
        this.events = this.events.filter((event) => !deletedIds.has(event.id));

        for (const event of changes.inserts) {
          const insertRow = buildEventStateInsertRow(CALENDAR_ID, event);
          const existingIndex = this.events.findIndex((existing) =>
            persistenceIdentityMatches(existing, insertRow),
          );
          const existingId = this.events[existingIndex]?.id;
          const id = existingId ?? `persisted-${this.nextId}`;
          const persisted = toPersistedEventState(id, insertRow);

          if (existingIndex === -1) {
            this.events.push(persisted);
            this.nextId += 1;
          } else {
            this.events[existingIndex] = persisted;
          }
        }

        return Promise.resolve();
      },
      readExistingEvents: () => Promise.resolve(this.events.map((event) => ({ ...event }))),
    });

    return {
      flushes: this.flushCount - flushCountBefore,
      result,
    };
  }

  public get persistedEventCount(): number {
    return this.events.length;
  }

  public get persistedSnapshot(): unknown[] {
    return this.events
      .map((event) => ({
        ...event,
        endTime: event.endTime.toISOString(),
        recurrenceId: event.recurrenceId?.toISOString() ?? null,
        startTime: event.startTime.toISOString(),
      }))
      .toSorted((left, right) =>
        buildSourceEventInstanceKey({
          endTime: new Date(left.endTime),
          recurrenceId: parseOptionalDate(left.recurrenceId),
          startTime: new Date(left.startTime),
          uid: left.sourceEventUid ?? "",
        }).localeCompare(buildSourceEventInstanceKey({
          endTime: new Date(right.endTime),
          recurrenceId: parseOptionalDate(right.recurrenceId),
          startTime: new Date(right.startTime),
          uid: right.sourceEventUid ?? "",
        })),
      );
  }

  public findPersistedIdByRecurrenceId(recurrenceId: string): string | null {
    return this.events.find(
      (event) => event.recurrenceId?.toISOString() === recurrenceId,
    )?.id ?? null;
  }

  public findMasterId(): string | null {
    return this.events.find((event) => event.recurrenceRule !== null)?.id ?? null;
  }

  public formatKeeperIcs(): string {
    const parsed = parseStoredSourceEventStates(this.events);
    return formatEventsAsIcal(parsed.map((event) => toCalendarEvent(event)), {
      customEventName: "Busy",
      excludeAllDayEvents: false,
      includeEventDescription: true,
      includeEventLocation: true,
      includeEventName: true,
    });
  }

  public parseKeeperCalendar(): ParsedKeeperCalendar {
    const calendar = parseIcsCalendar({ icsString: this.formatKeeperIcs() });
    const events = calendar.events ?? [];
    return {
      events,
      occurrences: materializeWeeklyCalendar(events),
    };
  }
}

export { RecurrenceCalendarHarness };
export type { IngestStepResult, ParsedKeeperCalendar, SemanticOccurrence };
