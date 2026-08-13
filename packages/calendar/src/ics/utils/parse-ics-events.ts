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

const compareEventRevisions = (candidate: IcsEvent, current: IcsEvent): number => {
  const sequenceDelta = (candidate.sequence ?? 0) - (current.sequence ?? 0);
  if (sequenceDelta !== 0) {
    return Math.sign(sequenceDelta);
  }
  return Math.sign(getEventRevisionTime(candidate) - getEventRevisionTime(current));
};

const isNewerEventRevision = (candidate: IcsEvent, current: IcsEvent): boolean =>
  compareEventRevisions(candidate, current) > 0;

/*
 * The slot a VEVENT would occupy in storage, read straight off the parsed
 * properties so it can be built for any VEVENT without evaluating a DURATION
 * that convertCanonicalEvent would reject. Two VEVENTs sharing a revision
 * identity but not a slot signature cannot both be stored.
 */
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

/*
 * Revision ties carry no ordering information, so the winner is pinned to the
 * lowest slot signature rather than to feed order: a publisher that renders
 * from an unordered query would otherwise swap the stored row on every poll,
 * deleting and re-creating it forever. Every slot the group holds other than
 * the winner's is a row the storage model cannot keep, whether it lost on a
 * tie-break or on revision order; an event superseded by a genuinely newer
 * revision of the same slot is not a loss and stays uncounted.
 */
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

  /*
   * A bare copy superseded by a revised namesake never met that namesake in a
   * revision group, so nothing upstream has counted it. It still vanishes from
   * the diff and takes its stored row with it, so the slot it would have
   * occupied is reported here alongside the ones the groups collapsed.
   */
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

/**
 * Skipping a Keeper-authored mirror is a deliberate no-op, not a lost event.
 * Counting the two together would leave `unrepresentable` permanently non-zero
 * on any mirrored calendar, drowning the one-off drop it exists to surface.
 */
interface ParsedIcsEventDiagnostics {
  events: EventTimeSlot[];
  selfAuthoredCount: number;
  unrepresentableCount: number;
}

/*
 * Stored rows are keyed per instance, so a modified occurrence is its own row
 * even though it shares its UID with the series master. Counting per UID would
 * hide the drop of an override behind a master that still parses, which is the
 * one deletion this counter most needs to surface.
 */
const buildInstanceIdentity = (uid: string, recurrenceDate: Date | undefined): string => {
  if (!recurrenceDate) {
    return `${uid}|master`;
  }
  return buildRecurrenceIdentity(uid, recurrenceDate);
};

/*
 * A VEVENT with no UID or no DTSTART is dropped before it ever reaches the
 * output, and every snapshot source reads that absence as "the publisher
 * removed it" and deletes the stored row. Counting the drop here is what keeps
 * that deletion from being silent. Revisions of the same instance are counted
 * once, and an instance that still produced an event is not a loss.
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
    if (!event.start?.date && !parsedIdentities.has(identity)) {
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
  const { collapsedSlotCount, events: canonicalEvents } =
    selectCanonicalEventRevisions(rawEvents);
  assertNoRangedOverrides(canonicalEvents);
  const cancellations = collectCancellationState(canonicalEvents);
  const events = canonicalEvents.flatMap((event) => {
    if (shouldSkipEvent(event, options, cancellations)) {
      return [];
    }
    return [convertCanonicalEvent(event, cancellations)];
  });

  const discarded = countDiscardedIcsEvents(
    rawEvents,
    options,
    new Set(events.map(({ recurrenceId, uid }) => buildInstanceIdentity(uid, recurrenceId))),
  );

  return {
    events,
    selfAuthoredCount: discarded.selfAuthoredCount,
    unrepresentableCount: discarded.unrepresentableCount + collapsedSlotCount,
  };
};

const parseIcsEvents = (
  calendar: IcsCalendar,
  options: ParseIcsEventsOptions = {},
): EventTimeSlot[] => parseIcsEventsWithDiagnostics(calendar, options).events;

export { parseIcsEvents, parseIcsEventsWithDiagnostics };
export type { ParsedIcsEventDiagnostics };
