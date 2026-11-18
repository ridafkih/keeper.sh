import type { CalendarSource, InheritedSource } from "@/types/api";

export interface InheritedCalendar {
  calendar: CalendarSource;
  viaCalendars: CalendarSource[];
}

export const listSourcesInheritedThrough = (
  inheritedSources: InheritedSource[],
  throughCalendarId: string,
  calendars: CalendarSource[],
): InheritedCalendar[] => {
  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));

  return inheritedSources.flatMap((inheritedSource) => {
    const calendar = calendarsById.get(inheritedSource.sourceCalendarId);
    const lastViaCalendarId = inheritedSource.viaCalendarIds[inheritedSource.viaCalendarIds.length - 1];
    if (!calendar || lastViaCalendarId !== throughCalendarId) {
      return [];
    }
    const viaCalendars = inheritedSource.viaCalendarIds.flatMap((viaCalendarId) => {
      const viaCalendar = calendarsById.get(viaCalendarId);
      return viaCalendar ? [viaCalendar] : [];
    });
    return [{ calendar, viaCalendars }];
  });
};

export const formatViaCalendars = (viaCalendars: CalendarSource[]): string =>
  `via ${viaCalendars.map((calendar) => calendar.name).join(", then ")}`;
