import type {
  IcsCalendar,
  IcsDateObject,
  IcsEvent,
  IcsExceptionDates,
} from "ts-ics";
import type { EventTimeSlot } from "./types";
import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";
import { normalizeTimezone } from "./normalize-timezone";
import { addIcsDuration } from "./recurrence-duration";
import { MS_PER_DAY } from "@keeper.sh/constants";

const getEventStartTimeZone = (event: IcsEvent): string | undefined =>
  normalizeTimezone(event.start.local?.timezone);

const getEventEndTime = (event: IcsEvent, startTime: Date): Date => {
  const isAllDay = event.start.type === "DATE";
  if ("end" in event && event.end) {
    return event.end.date;
  }

  if ("duration" in event && event.duration) {
    if (event.duration.before) {
      throw new RangeError("VEVENT DURATION must be positive");
    }
    if (
      isAllDay
      && (event.duration.hours || event.duration.minutes || event.duration.seconds)
    ) {
      throw new RangeError("All-day VEVENT DURATION must use weeks or days");
    }
    return addIcsDuration(startTime, event.duration, getEventStartTimeZone(event));
  }

  if (isAllDay) {
    return new Date(startTime.getTime() + MS_PER_DAY);
  }

  return startTime;
};

const getRecurrenceDuration = (
  event: IcsEvent,
): EventTimeSlot["recurrenceDuration"] => {
  if (event.recurrenceRule && "duration" in event && event.duration) {
    return event.duration;
  }
  return globalThis.undefined;
};

const isKeeperEvent = (uid: string | undefined): boolean =>
  uid?.endsWith(KEEPER_EVENT_SUFFIX) ?? false;

const getEventAvailability = (event: IcsEvent) => {
  if (event.timeTransparent === "TRANSPARENT") {
    return "free";
  }

  if (event.timeTransparent === "OPAQUE") {
    return "busy";
  }

  return null;
};

const buildRecurrenceIdentity = (uid: string, recurrenceDate: Date): string =>
  `${uid}|${recurrenceDate.toISOString()}`;

const buildEventRevisionIdentity = (event: IcsEvent): string | null => {
  if (!event.uid) {
    return null;
  }
  if (event.recurrenceId) {
    return buildRecurrenceIdentity(event.uid, event.recurrenceId.value.date);
  }
  if (
    event.status
    || typeof event.sequence === "number"
    || event.lastModified
  ) {
    return `${event.uid}|master`;
  }
  if (!event.start?.date) {
    return null;
  }
  return `${event.uid}|slot|${event.start.date.toISOString()}|${getEventEndTime(
    event,
    event.start.date,
  ).toISOString()}`;
};

const getEventRevisionTime = (event: IcsEvent): number =>
  event.lastModified?.date.getTime()
  ?? event.stamp?.date.getTime()
  ?? event.created?.date.getTime()
  ?? 0;

const isNewerEventRevision = (candidate: IcsEvent, current: IcsEvent): boolean => {
  const candidateSequence = candidate.sequence ?? 0;
  const currentSequence = current.sequence ?? 0;
  if (candidateSequence !== currentSequence) {
    return candidateSequence > currentSequence;
  }
  return getEventRevisionTime(candidate) > getEventRevisionTime(current);
};

const selectCanonicalEventRevisions = (events: IcsEvent[]): IcsEvent[] => {
  const revisions = new Map<string, IcsEvent>();
  for (const event of events) {
    const identity = buildEventRevisionIdentity(event);
    if (!identity) {
      continue;
    }
    const current = revisions.get(identity);
    if (!current || isNewerEventRevision(event, current)) {
      revisions.set(identity, event);
    }
  }
  const canonicalEvents = [...revisions.values()];
  const authoritativeMasterByUid = new Map<string, IcsEvent>();
  for (const event of canonicalEvents) {
    if (!event.uid || buildEventRevisionIdentity(event) !== `${event.uid}|master`) {
      continue;
    }
    const current = authoritativeMasterByUid.get(event.uid);
    if (!current || isNewerEventRevision(event, current)) {
      authoritativeMasterByUid.set(event.uid, event);
    }
  }

  return canonicalEvents.filter((event) => {
    if (!event.uid || event.recurrenceId) {
      return true;
    }
    const identity = buildEventRevisionIdentity(event);
    if (!identity?.includes("|slot|")) {
      return true;
    }
    const authoritativeMaster = authoritativeMasterByUid.get(event.uid);
    return !authoritativeMaster || isNewerEventRevision(event, authoritativeMaster);
  });
};

const mergeExceptionDates = (
  exceptionDates: IcsExceptionDates | undefined,
  cancelledDates: IcsDateObject[],
): IcsExceptionDates | undefined => {
  const merged = new Map<string, IcsDateObject>();
  for (const exceptionDate of [...exceptionDates ?? [], ...cancelledDates]) {
    merged.set(exceptionDate.date.toISOString(), exceptionDate);
  }
  if (merged.size === 0) {
    return;
  }
  return [...merged.values()];
};

interface ParseIcsEventsOptions {
  includeKeeperEvents?: boolean;
}

interface CancellationState {
  cancelledMasters: Map<string, IcsEvent>;
  cancelledRecurrences: Map<string, IcsDateObject[]>;
  cancelledRecurrenceIdentities: Set<string>;
}

const assertNoRangedOverrides = (events: IcsEvent[]): void => {
  const rangedOverride = events.find(
    (event) => event.recurrenceId?.range === "THISANDFUTURE",
  );
  if (rangedOverride) {
    throw new RangeError(
      `RECURRENCE-ID;RANGE=THISANDFUTURE is not supported for event ${rangedOverride.uid ?? "<missing UID>"}`,
    );
  }
};

const collectCancellationState = (events: IcsEvent[]): CancellationState => {
  const cancelledMasters = new Map<string, IcsEvent>();
  const cancelledRecurrences = new Map<string, IcsDateObject[]>();

  for (const event of events) {
    if (event.status !== "CANCELLED" || !event.uid) {
      continue;
    }
    if (!event.recurrenceId) {
      const current = cancelledMasters.get(event.uid);
      if (!current || isNewerEventRevision(event, current)) {
        cancelledMasters.set(event.uid, event);
      }
      continue;
    }
    const dates = cancelledRecurrences.get(event.uid) ?? [];
    dates.push(event.recurrenceId.value);
    cancelledRecurrences.set(event.uid, dates);
  }

  const cancelledRecurrenceIdentities = new Set(
    [...cancelledRecurrences].flatMap(([uid, dates]) =>
      dates.map((date) => buildRecurrenceIdentity(uid, date.date))),
  );
  return { cancelledMasters, cancelledRecurrences, cancelledRecurrenceIdentities };
};

const shouldSkipEvent = (
  event: IcsEvent,
  options: ParseIcsEventsOptions,
  cancellations: CancellationState,
): boolean => {
  if (!event.uid || !event.start?.date) {
    return true;
  }
  if (!options.includeKeeperEvents && isKeeperEvent(event.uid)) {
    return true;
  }
  if (event.status === "CANCELLED") {
    return true;
  }
  const masterCancellation = cancellations.cancelledMasters.get(event.uid);
  if (masterCancellation && !isNewerEventRevision(event, masterCancellation)) {
    return true;
  }
  return Boolean(
    event.recurrenceId
    && cancellations.cancelledRecurrenceIdentities.has(
      buildRecurrenceIdentity(event.uid, event.recurrenceId.value.date),
    ),
  );
};

const convertCanonicalEvent = (
  event: IcsEvent,
  cancellations: CancellationState,
): EventTimeSlot => {
  if (!event.uid || !event.start?.date) {
    throw new TypeError("Canonical event must have a UID and DTSTART");
  }

  const startTime = event.start.date;
  const availability = getEventAvailability(event);
  const recurrenceDuration = getRecurrenceDuration(event);
  let { exceptionDates } = event;
  if (event.recurrenceRule) {
    exceptionDates = mergeExceptionDates(
      event.exceptionDates,
      cancellations.cancelledRecurrences.get(event.uid) ?? [],
    );
  }

  return {
    ...availability && { availability },
    description: event.description,
    endTime: getEventEndTime(event, startTime),
    exceptionDates,
    recurrenceId: event.recurrenceId?.value?.date,
    isAllDay: event.start.type === "DATE",
    location: event.location,
    ...(recurrenceDuration && { recurrenceDuration }),
    recurrenceRule: event.recurrenceRule,
    startTime,
    startTimeZone: getEventStartTimeZone(event),
    title: event.summary,
    uid: event.uid,
  };
};

const parseIcsEvents = (
  calendar: IcsCalendar,
  options: ParseIcsEventsOptions = {},
): EventTimeSlot[] => {
  const canonicalEvents = selectCanonicalEventRevisions(calendar.events ?? []);
  assertNoRangedOverrides(canonicalEvents);
  const cancellations = collectCancellationState(canonicalEvents);
  return canonicalEvents.flatMap((event) => {
    if (shouldSkipEvent(event, options, cancellations)) {
      return [];
    }
    return [convertCanonicalEvent(event, cancellations)];
  });
};

export { parseIcsEvents };
