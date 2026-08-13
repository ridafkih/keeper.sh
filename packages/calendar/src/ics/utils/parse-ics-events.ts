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

// Total by design: throwing here would drop the whole calendar, not the one VEVENT.
const resolveEventEndTime = (event: IcsEvent, startTime: Date): Date | null => {
  const isAllDay = event.start.type === "DATE";
  if ("end" in event && event.end) {
    return event.end.date;
  }

  if ("duration" in event && event.duration) {
    if (event.duration.before) {
      return null;
    }
    if (
      isAllDay
      && (event.duration.hours || event.duration.minutes || event.duration.seconds)
    ) {
      return null;
    }
    return addIcsDuration(startTime, event.duration, getEventStartTimeZone(event));
  }

  if (isAllDay) {
    return new Date(startTime.getTime() + MS_PER_DAY);
  }

  return startTime;
};

const isUnbuildableEvent = (event: IcsEvent): boolean => {
  const startTime = event.start?.date;
  if (!startTime) {
    return false;
  }
  return resolveEventEndTime(event, startTime) === null;
};

const getEventEndTime = (event: IcsEvent, startTime: Date): Date => {
  const endTime = resolveEventEndTime(event, startTime);
  if (!endTime) {
    throw new TypeError("An unbuildable VEVENT must be dropped before it is converted");
  }
  return endTime;
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

const compareEventRevisions = (candidate: IcsEvent, current: IcsEvent): number => {
  const sequenceDelta = (candidate.sequence ?? 0) - (current.sequence ?? 0);
  if (sequenceDelta !== 0) {
    return Math.sign(sequenceDelta);
  }
  return Math.sign(getEventRevisionTime(candidate) - getEventRevisionTime(current));
};

const isNewerEventRevision = (candidate: IcsEvent, current: IcsEvent): boolean =>
  compareEventRevisions(candidate, current) > 0;

const describeEventDuration = (event: IcsEvent): string => {
  if (!event.duration) {
    return "none";
  }
  return JSON.stringify(event.duration);
};

const buildEventSlotSignature = (event: IcsEvent): string => [
  event.start?.date.getTime() ?? "none",
  event.end?.date.getTime() ?? "none",
  describeEventDuration(event),
].join("|");

interface CanonicalEventRevision {
  collapsedSlotCount: number;
  event: IcsEvent;
}

const collapsedSlotSignatures = (
  events: readonly IcsEvent[],
  winner: IcsEvent,
): Set<string> => {
  const winnerSignature = buildEventSlotSignature(winner);
  return new Set(
    events
      .map((event) => buildEventSlotSignature(event))
      .filter((signature) => signature !== winnerSignature),
  );
};

/*
 * Ties break on the lowest slot signature, never on feed order: an unordered
 * publisher would otherwise delete and re-create the stored row on every poll.
 */
const selectGroupRevision = (group: readonly IcsEvent[]): CanonicalEventRevision => {
  const [first, ...rest] = group;
  if (!first) {
    throw new TypeError("A revision group must hold at least one VEVENT");
  }
  let winner = first;
  for (const event of rest) {
    const order = compareEventRevisions(event, winner);
    if (
      order > 0
      || order === 0 && buildEventSlotSignature(event) < buildEventSlotSignature(winner)
    ) {
      winner = event;
    }
  }
  return {
    collapsedSlotCount: collapsedSlotSignatures(group, winner).size,
    event: winner,
  };
};

interface CanonicalEventRevisions {
  collapsedSlotCount: number;
  events: IcsEvent[];
}

const groupEventsByRevisionIdentity = (
  events: readonly IcsEvent[],
): Map<string, IcsEvent[]> => {
  const groups = new Map<string, IcsEvent[]>();
  for (const event of events) {
    const identity = buildEventRevisionIdentity(event);
    if (!identity) {
      continue;
    }
    groups.set(identity, [...groups.get(identity) ?? [], event]);
  }
  return groups;
};

const selectCanonicalEventRevisions = (
  events: IcsEvent[],
): CanonicalEventRevisions => {
  const revisions = [...groupEventsByRevisionIdentity(events).values()]
    .map((group) => selectGroupRevision(group));
  const groupedCollapsedSlotCount = revisions.reduce(
    (total, revision) => total + revision.collapsedSlotCount,
    0,
  );
  const canonicalEvents = revisions.map(({ event }) => event);
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

  const survivesAuthoritativeMaster = (event: IcsEvent): boolean => {
    if (!event.uid || event.recurrenceId) {
      return true;
    }
    const identity = buildEventRevisionIdentity(event);
    if (!identity?.includes("|slot|")) {
      return true;
    }
    const authoritativeMaster = authoritativeMasterByUid.get(event.uid);
    return !authoritativeMaster || isNewerEventRevision(event, authoritativeMaster);
  };
  const supersededSlots = new Set(
    canonicalEvents
      .filter((event) => !survivesAuthoritativeMaster(event))
      .flatMap((event) => {
        const authoritativeMaster = authoritativeMasterByUid.get(event.uid ?? "");
        if (!authoritativeMaster) {
          throw new TypeError("A superseded VEVENT must have an authoritative master");
        }
        return [...collapsedSlotSignatures([event], authoritativeMaster)]
          .map((signature) => `${event.uid ?? ""}|${signature}`);
      }),
  );

  return {
    collapsedSlotCount: groupedCollapsedSlotCount + supersededSlots.size,
    events: canonicalEvents.filter((event) => survivesAuthoritativeMaster(event)),
  };
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

/*
 * Reported rather than thrown so the caller withholds only this UID; the rest
 * of the feed still syncs.
 */
const collectRangedOverrideEvents = (
  events: readonly IcsEvent[],
): UnsupportedIcsEvent[] => {
  const unsupported = new Map<string, UnsupportedIcsEvent>();
  for (const event of events) {
    if (event.recurrenceId?.range !== "THISANDFUTURE" || !event.uid) {
      continue;
    }
    unsupported.set(event.uid, {
      reason: `RECURRENCE-ID;RANGE=THISANDFUTURE is not supported for event ${event.uid}`,
      uid: event.uid,
    });
  }
  return [...unsupported.values()];
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

/**
 * Withheld from ingestion, yet kept in `events` so a snapshot diff does not
 * read it as deleted.
 */
interface UnsupportedIcsEvent {
  reason: string;
  uid: string;
}

interface ParsedIcsEventDiagnostics {
  events: EventTimeSlot[];
  selfAuthoredCount: number;
  unrepresentableCount: number;
  unsupportedEvents: UnsupportedIcsEvent[];
}

const buildInstanceIdentity = (uid: string, recurrenceDate: Date | undefined): string => {
  if (!recurrenceDate) {
    return `${uid}|master`;
  }
  return buildRecurrenceIdentity(uid, recurrenceDate);
};

interface StaleRevisions {
  identities: Set<string>;
  unsupported: UnsupportedIcsEvent[];
}

/*
 * An unbuildable newest revision must withhold its UID: letting the older
 * revision it superseded win would sync the instance at a stale time.
 */
const collectStaleRevisions = (
  rawEvents: readonly IcsEvent[],
  canonicalEvents: readonly IcsEvent[],
): StaleRevisions => {
  const canonicalByIdentity = new Map<string, IcsEvent>();
  for (const event of canonicalEvents) {
    if (!event.uid) {
      continue;
    }
    canonicalByIdentity.set(
      buildInstanceIdentity(event.uid, event.recurrenceId?.value.date),
      event,
    );
  }

  const identities = new Set<string>();
  const unsupported = new Map<string, UnsupportedIcsEvent>();
  for (const event of rawEvents) {
    if (!event.uid || !isUnbuildableEvent(event)) {
      continue;
    }
    const identity = buildInstanceIdentity(event.uid, event.recurrenceId?.value.date);
    const superseded = canonicalByIdentity.get(identity);
    if (!superseded || !isNewerEventRevision(event, superseded)) {
      continue;
    }
    identities.add(identity);
    unsupported.set(event.uid, {
      reason: `The newest revision of event ${event.uid} has a span Keeper cannot represent`,
      uid: event.uid,
    });
  }

  return { identities, unsupported: [...unsupported.values()] };
};

const mergeUnsupportedEvents = (
  ...groups: readonly UnsupportedIcsEvent[][]
): UnsupportedIcsEvent[] => [
  ...new Map(groups.flat().map((event) => [event.uid, event])).values(),
];

/*
 * A dropped VEVENT is read downstream as a deletion; this counter is the only
 * trace it leaves.
 */
const countDiscardedIcsEvents = (
  rawEvents: readonly IcsEvent[],
  options: ParseIcsEventsOptions,
  parsedIdentities: ReadonlySet<string>,
): Pick<ParsedIcsEventDiagnostics, "selfAuthoredCount" | "unrepresentableCount"> => {
  const selfAuthoredUids = new Set<string>();
  const unrepresentableIdentities = new Set<string>();
  let anonymousUnrepresentableCount = 0;

  for (const event of rawEvents) {
    if (!event.uid) {
      anonymousUnrepresentableCount += 1;
      continue;
    }
    if (!options.includeKeeperEvents && isKeeperEvent(event.uid)) {
      selfAuthoredUids.add(event.uid);
      continue;
    }
    const identity = buildInstanceIdentity(event.uid, event.recurrenceId?.value.date);
    if (
      (!event.start?.date || isUnbuildableEvent(event))
      && !parsedIdentities.has(identity)
    ) {
      unrepresentableIdentities.add(identity);
    }
  }

  return {
    selfAuthoredCount: selfAuthoredUids.size,
    unrepresentableCount: anonymousUnrepresentableCount + unrepresentableIdentities.size,
  };
};

const parseIcsEventsWithDiagnostics = (
  calendar: IcsCalendar,
  options: ParseIcsEventsOptions = {},
): ParsedIcsEventDiagnostics => {
  const rawEvents = calendar.events ?? [];
  const { collapsedSlotCount, events: canonicalEvents } = selectCanonicalEventRevisions(
    rawEvents.filter((event) => !isUnbuildableEvent(event)),
  );
  const cancellations = collectCancellationState(canonicalEvents);
  const events = canonicalEvents.flatMap((event) => {
    if (shouldSkipEvent(event, options, cancellations)) {
      return [];
    }
    return [convertCanonicalEvent(event, cancellations)];
  });

  const stale = collectStaleRevisions(rawEvents, canonicalEvents);
  const parsedIdentities = events
    .map(({ recurrenceId, uid }) => buildInstanceIdentity(uid, recurrenceId))
    .filter((identity) => !stale.identities.has(identity));

  const discarded = countDiscardedIcsEvents(rawEvents, options, new Set(parsedIdentities));

  return {
    events,
    selfAuthoredCount: discarded.selfAuthoredCount,
    unrepresentableCount: discarded.unrepresentableCount + collapsedSlotCount,
    unsupportedEvents: mergeUnsupportedEvents(
      collectRangedOverrideEvents(canonicalEvents),
      stale.unsupported,
    ),
  };
};

const parseIcsEvents = (
  calendar: IcsCalendar,
  options: ParseIcsEventsOptions = {},
): EventTimeSlot[] => parseIcsEventsWithDiagnostics(calendar, options).events;

export { parseIcsEvents, parseIcsEventsWithDiagnostics };
export type { ParsedIcsEventDiagnostics, UnsupportedIcsEvent };
