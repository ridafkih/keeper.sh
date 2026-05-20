import { calendarsTable, eventStatesTable, icalFeedSettingsTable } from "@keeper.sh/database/schema";
import { and, asc, eq, inArray, ne, or, isNull } from "drizzle-orm";
import type { IcsDateObject, IcsRecurrenceRule } from "ts-ics";
import { resolveUserIdentifier } from "./user";
import { database } from "@/context";
import { formatEventsAsIcal } from "./ical-format";
import type { CalendarEvent, FeedSettings } from "./ical-format";

const parseJsonField = <TValue>(value: string | null): TValue | null => {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as TValue;
  } catch {
    return null;
  }
};

const reviveDates = (value: unknown): unknown => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    return new Date(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => reviveDates(item));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = reviveDates(val);
    }
    return result;
  }
  return value;
};

const parseRecurrenceRule = (value: string | null): IcsRecurrenceRule | null => {
  const parsed = parseJsonField<IcsRecurrenceRule>(value);
  if (!parsed) {
    return null;
  }
  // Restore Date instances stripped by JSON.parse — ts-ics requires Date objects on the in-memory shape.
  return reviveDates(parsed) as IcsRecurrenceRule;
};

const parseExceptionDates = (value: string | null): IcsDateObject[] | null => {
  const parsed = parseJsonField<IcsDateObject[]>(value);
  if (!parsed) {
    return null;
  }
  return reviveDates(parsed) as IcsDateObject[];
};

const DEFAULT_FEED_SETTINGS: FeedSettings = {
  includeEventName: false,
  includeEventDescription: false,
  includeEventLocation: false,
  excludeAllDayEvents: false,
  customEventName: "Busy",
};

const getFeedSettings = async (userId: string): Promise<FeedSettings> => {
  const [settings] = await database
    .select()
    .from(icalFeedSettingsTable)
    .where(eq(icalFeedSettingsTable.userId, userId))
    .limit(1);

  return settings ?? DEFAULT_FEED_SETTINGS;
};

const generateUserCalendar = async (identifier: string): Promise<string | null> => {
  const userId = await resolveUserIdentifier(identifier);

  if (!userId) {
    return null;
  }

  const [settings, sources] = await Promise.all([
    getFeedSettings(userId),
    database
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          eq(calendarsTable.includeInIcalFeed, true),
        ),
      ),
  ]);

  if (sources.length === 0) {
    return formatEventsAsIcal([], settings);
  }

  const calendarIds = sources.map(({ id }) => id);
  const rows = await database
    .select({
      id: eventStatesTable.id,
      title: eventStatesTable.title,
      description: eventStatesTable.description,
      location: eventStatesTable.location,
      startTime: eventStatesTable.startTime,
      endTime: eventStatesTable.endTime,
      isAllDay: eventStatesTable.isAllDay,
      recurrenceRule: eventStatesTable.recurrenceRule,
      exceptionDates: eventStatesTable.exceptionDates,
      recurrenceId: eventStatesTable.recurrenceId,
      sourceEventUid: eventStatesTable.sourceEventUid,
      calendarName: calendarsTable.name,
    })
    .from(eventStatesTable)
    .innerJoin(calendarsTable, eq(eventStatesTable.calendarId, calendarsTable.id))
    .where(
      and(
        inArray(eventStatesTable.calendarId, calendarIds),
        or(
          isNull(eventStatesTable.sourceEventType),
          ne(eventStatesTable.sourceEventType, "workingLocation"),
        ),
        or(
          isNull(eventStatesTable.availability),
          ne(eventStatesTable.availability, "workingElsewhere"),
        ),
      ),
    )
    .orderBy(asc(eventStatesTable.startTime));

  const events: CalendarEvent[] = rows.map((row) => ({
    ...row,
    recurrenceRule: parseRecurrenceRule(row.recurrenceRule),
    exceptionDates: parseExceptionDates(row.exceptionDates),
  }));

  return formatEventsAsIcal(events, settings);
};

export { generateUserCalendar };
