interface EventStart {
  startTime: Date;
  isAllDay: boolean;
}

interface EventEnd {
  endTime: Date;
  isAllDay: boolean;
}

export const ALL_DAY_LABEL = "All day";

const localMidnightOfUtcDate = (instant: Date): Date =>
  new Date(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());

const localMidnightOf = (instant: Date): Date =>
  new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());

export const resolveEventStartDay = (event: EventStart): Date =>
  event.isAllDay ? localMidnightOfUtcDate(event.startTime) : localMidnightOf(event.startTime);

export const resolveEventLocalStart = (event: EventStart): Date =>
  event.isAllDay ? localMidnightOfUtcDate(event.startTime) : event.startTime;

export const resolveEventLocalEnd = (event: EventEnd): Date =>
  event.isAllDay ? localMidnightOfUtcDate(event.endTime) : event.endTime;

export const resolveViewerTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
