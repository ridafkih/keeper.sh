import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";
import { resolveIsAllDayEvent } from "@keeper.sh/calendar";
import { buildVtimezone, buildZonedIcsDate } from "@keeper.sh/calendar/ics";
import { generateIcsCalendar } from "ts-ics";
import type { IcsCalendar, IcsDateObject, IcsDuration, IcsEvent, IcsRecurrenceRule, IcsTimezone } from "ts-ics";

interface FeedSettings {
  includeEventName: boolean;
  includeEventDescription: boolean;
  includeEventLocation: boolean;
  excludeAllDayEvents: boolean;
  customEventName: string;
}

interface CalendarEvent {
  id: string;
  calendarId: string;
  availability: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean | null;
  calendarName: string;
  recurrenceRule: IcsRecurrenceRule | null;
  recurrenceDuration: IcsDuration | null;
  exceptionDates: IcsDateObject[] | null;
  recurrenceId: Date | null;
  sourceEventUid: string | null;
  startTimeZone?: string | null;
}

const resolveEventTimeZone = (event: CalendarEvent): string | undefined =>
  buildZonedIcsDate(event.startTime, event.startTimeZone ?? "", false).local?.timezone;

const buildExceptionDate = (value: IcsDateObject, timezone: string | undefined): IcsDateObject => {
  if (value.type === "DATE") {
    return { date: value.date, type: "DATE" };
  }
  return buildZonedIcsDate(value.date, timezone, false);
};

const toUtcDateObject = (value: IcsDateObject): IcsDateObject => {
  if (value.type === "DATE") {
    return { date: value.date, type: "DATE" };
  }
  return { date: value.date };
};

const normalizeRecurrenceRuleToUtc = (rule: IcsRecurrenceRule): IcsRecurrenceRule => {
  if (!rule.until) {
    return rule;
  }
  return { ...rule, until: toUtcDateObject(rule.until) };
};

const toAllDayShape = (event: CalendarEvent) => ({
  startTime: event.startTime,
  endTime: event.endTime,
  ...(event.isAllDay !== null && { isAllDay: event.isAllDay }),
});

const resolveTemplate = (template: string, variables: Record<string, string>): string =>
  template.replaceAll(/\{\{(\w+)\}\}/g, (match, name) => variables[name] ?? match);

const resolveEventSummary = (event: CalendarEvent, settings: FeedSettings): string => {
  let template = settings.customEventName;
  if (settings.includeEventName) {
    template = event.title || settings.customEventName;
  }

  return resolveTemplate(template, {
    event_name: event.title || "Untitled",
    calendar_name: event.calendarName,
  });
};

const buildTransparency = (
  availability: CalendarEvent["availability"],
): Pick<IcsEvent, "timeTransparent"> => {
  if (availability === "free") {
    return { timeTransparent: "TRANSPARENT" };
  }
  return {};
};

interface EventGroup {
  master: CalendarEvent;
  overrides: CalendarEvent[];
}

const isRecurringMaster = (event: CalendarEvent): boolean =>
  event.recurrenceRule !== null && event.recurrenceId === null;

const groupEventsBySourceUid = (events: CalendarEvent[]): EventGroup[] => {
  const eventsBySourceUid = new Map<string, CalendarEvent[]>();
  const ungrouped: EventGroup[] = [];

  for (const event of events) {
    if (!event.sourceEventUid) {
      ungrouped.push({ master: event, overrides: [] });
      continue;
    }
    const sourceKey = JSON.stringify([event.calendarId, event.sourceEventUid]);
    const sourceEvents = eventsBySourceUid.get(sourceKey) ?? [];
    sourceEvents.push(event);
    eventsBySourceUid.set(sourceKey, sourceEvents);
  }

  const groups: EventGroup[] = [];
  for (const sourceEvents of eventsBySourceUid.values()) {
    const masters = sourceEvents.filter((event) => isRecurringMaster(event));
    if (masters.length !== 1) {
      ungrouped.push(...sourceEvents.map((event) => ({ master: event, overrides: [] })));
      continue;
    }

    const [master] = masters;
    if (!master) {
      continue;
    }
    const overrides = sourceEvents.filter(
      (event) => event !== master && event.recurrenceId !== null,
    );
    groups.push({ master, overrides });
    const standaloneEvents = sourceEvents.filter(
      (event) => event !== master && event.recurrenceId === null,
    );
    ungrouped.push(...standaloneEvents.map((event) => ({ master: event, overrides: [] })));
  }

  return [...groups, ...ungrouped];
};

const buildBaseIcsEvent = (event: CalendarEvent, uid: string, settings: FeedSettings): IcsEvent => {
  const isAllDay = resolveIsAllDayEvent(toAllDayShape(event));
  const timezone = event.startTimeZone ?? "";
  const common = {
    stamp: { date: new Date() },
    start: buildZonedIcsDate(event.startTime, timezone, isAllDay),
    summary: resolveEventSummary(event, settings),
    uid,
    ...buildTransparency(event.availability),
    ...(settings.includeEventDescription && event.description && { description: event.description }),
    ...(settings.includeEventLocation && event.location && { location: event.location }),
  };
  if (event.recurrenceRule && event.recurrenceDuration) {
    return { ...common, duration: event.recurrenceDuration };
  }
  return { ...common, end: buildZonedIcsDate(event.endTime, timezone, isAllDay) };
};

const buildMasterIcsEvent = (master: CalendarEvent, uid: string, settings: FeedSettings): IcsEvent => {
  const timezone = resolveEventTimeZone(master);
  return {
    ...buildBaseIcsEvent(master, uid, settings),
    ...(master.recurrenceRule && { recurrenceRule: normalizeRecurrenceRuleToUtc(master.recurrenceRule) }),
    ...(master.exceptionDates?.length && {
      exceptionDates: master.exceptionDates.map((value) => buildExceptionDate(value, timezone)),
    }),
  };
};

const buildOverrideIcsEvent = (
  override: CalendarEvent,
  uid: string,
  settings: FeedSettings,
  masterTimeZone: string | undefined,
  masterIsAllDay: boolean,
): IcsEvent => ({
  ...buildBaseIcsEvent(override, uid, settings),
  ...(override.recurrenceId && {
    recurrenceId: { value: buildZonedIcsDate(override.recurrenceId, masterTimeZone, masterIsAllDay) },
  }),
});

const buildIcsEventsForGroup = (group: EventGroup, settings: FeedSettings): IcsEvent[] => {
  const uid = `${group.master.id}${KEEPER_EVENT_SUFFIX}`;
  const masterTimeZone = resolveEventTimeZone(group.master);
  const masterIsAllDay = resolveIsAllDayEvent(toAllDayShape(group.master));
  return [
    buildMasterIcsEvent(group.master, uid, settings),
    ...group.overrides.map((override) =>
      buildOverrideIcsEvent(override, uid, settings, masterTimeZone, masterIsAllDay),
    ),
  ];
};

const collectTimezones = (events: CalendarEvent[]): IcsTimezone[] => {
  const referenceByZone = new Map<string, Date>();
  for (const event of events) {
    if (resolveIsAllDayEvent(toAllDayShape(event))) {
      continue;
    }
    const zone = resolveEventTimeZone(event);
    if (zone && !referenceByZone.has(zone)) {
      referenceByZone.set(zone, event.startTime);
    }
  }

  const timezones: IcsTimezone[] = [];
  for (const [zone, reference] of referenceByZone) {
    const timezone = buildVtimezone(zone, reference);
    if (timezone) {
      timezones.push(timezone);
    }
  }
  return timezones;
};

const shouldIncludeEvent = (event: CalendarEvent, settings: FeedSettings): boolean => {
  if (!settings.excludeAllDayEvents) {
    return true;
  }
  return !resolveIsAllDayEvent(toAllDayShape(event));
};

const formatEventsAsIcal = (events: CalendarEvent[], settings: FeedSettings): string => {
  const groups = groupEventsBySourceUid(events).flatMap((group): EventGroup[] => {
    if (!shouldIncludeEvent(group.master, settings)) {
      return group.overrides
        .filter((override) => shouldIncludeEvent(override, settings))
        .map((override) => ({ master: override, overrides: [] }));
    }
    const includedOverrides = group.overrides.filter(
      (override) => shouldIncludeEvent(override, settings),
    );
    const excludedOverrideDates = group.overrides.flatMap((override): IcsDateObject[] => {
      if (shouldIncludeEvent(override, settings) || !override.recurrenceId) {
        return [];
      }
      return [{ date: override.recurrenceId }];
    });
    if (excludedOverrideDates.length === 0) {
      return [{ master: group.master, overrides: includedOverrides }];
    }
    return [{
      master: {
        ...group.master,
        exceptionDates: [
          ...group.master.exceptionDates ?? [],
          ...excludedOverrideDates,
        ],
      },
      overrides: includedOverrides,
    }];
  });
  const icsEvents = groups.flatMap((group) => buildIcsEventsForGroup(group, settings));
  const includedEvents = groups.flatMap(({ master, overrides }) => [master, ...overrides]);
  const timezones = collectTimezones(includedEvents);

  const calendar: IcsCalendar = {
    events: icsEvents,
    prodId: "-//Keeper//Keeper Calendar//EN",
    version: "2.0",
    ...(timezones.length > 0 && { timezones }),
  };

  return generateIcsCalendar(calendar);
};

export { formatEventsAsIcal };
export type { CalendarEvent, FeedSettings };
