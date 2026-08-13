import type { IcsRecurrenceRule } from "ts-ics";
import { visitIcsProperties } from "./apply-patches";
import { isSupportedTimeZone } from "./timezone-instant";
import { resolveDeclaredTimeZone } from "./resolve-timezone-identifier";
import type { DeclaredTimeZoneOffsets } from "./resolve-timezone-identifier";

interface RecurrenceTimeZoneInput {
  recurrenceRule?: IcsRecurrenceRule;
  startTimeZone?: string;
  uid: string;
}

interface RecurrenceTimeZoneResolution<Event> {
  events: Event[];
  unsupportedUids: string[];
}

interface UnsupportedRecurrenceEvent {
  reason: string;
  uid: string;
}

interface EventRecurrenceDateState {
  hasRecurrenceDates: boolean;
  uid: string;
}

const assertNoUnsupportedRecurrenceDates = (ical: string): void => {
  visitIcsProperties(ical, ({ componentPath, property }) => {
    if (componentPath.at(-1) === "VEVENT" && property === "RDATE") {
      throw new RangeError("ICS RDATE recurrence is not supported");
    }
  });
};

/**
 * RDATE stays unsupported because recurrence-materializer has no handling for
 * it and would silently drop the extra occurrences. Reporting the affected UIDs
 * instead of throwing keeps that rejection per-event: one client-written RDATE
 * must not stop every other event in the feed from syncing.
 */
const collectRecurrenceDateEventUids = (ical: string): string[] => {
  const states = new Map<number, EventRecurrenceDateState>();
  visitIcsProperties(ical, ({ componentInstancePath, componentPath, property, value }) => {
    const eventDepth = componentPath.indexOf("VEVENT");
    const eventInstance = componentInstancePath[eventDepth];
    if (eventDepth === -1 || eventInstance === globalThis.undefined) {
      return;
    }
    const current = states.get(eventInstance) ?? { hasRecurrenceDates: false, uid: "" };
    const isEventProperty = componentPath.at(-1) === "VEVENT";
    states.set(eventInstance, {
      hasRecurrenceDates: current.hasRecurrenceDates
        || isEventProperty && property === "RDATE",
      uid: (isEventProperty && property === "UID" && value) || current.uid,
    });
  });

  return [...states.values()]
    .filter((state) => state.hasRecurrenceDates && state.uid)
    .map((state) => state.uid);
};

/** Recurring events whose TZID no runtime can interpret. */
const collectUnsupportedRecurrenceTimeZones = (
  events: readonly RecurrenceTimeZoneInput[],
): UnsupportedRecurrenceEvent[] => {
  const unsupported = new Map<string, UnsupportedRecurrenceEvent>();
  for (const event of events) {
    if (!event.recurrenceRule || isSupportedTimeZone(event.startTimeZone)) {
      continue;
    }
    unsupported.set(event.uid, {
      reason: `Unsupported calendar timezone: ${event.startTimeZone ?? ""}`,
      uid: event.uid,
    });
  }
  return [...unsupported.values()];
};

/**
 * Recurring events are the only ones materialized against an Intl timezone, so
 * they are the only ones that need a resolvable identifier. Events whose zone
 * can be recovered are rewritten to the recovered zone; the rest are reported
 * so the caller can withhold them and count them, rather than failing the feed.
 */
const resolveRecurrenceTimeZones = <Event extends RecurrenceTimeZoneInput>(
  events: readonly Event[],
  declaredOffsets: DeclaredTimeZoneOffsets,
): RecurrenceTimeZoneResolution<Event> => {
  const unsupportedUids: string[] = [];
  const resolvedEvents = events.map((event) => {
    if (!event.recurrenceRule || !event.startTimeZone) {
      return event;
    }
    const timeZone = resolveDeclaredTimeZone(event.startTimeZone, declaredOffsets);
    if (!timeZone) {
      unsupportedUids.push(event.uid);
      return event;
    }
    if (timeZone === event.startTimeZone) {
      return event;
    }
    return { ...event, startTimeZone: timeZone };
  });

  return { events: resolvedEvents, unsupportedUids };
};

export {
  assertNoUnsupportedRecurrenceDates,
  collectRecurrenceDateEventUids,
  collectUnsupportedRecurrenceTimeZones,
  resolveRecurrenceTimeZones,
};
export type { UnsupportedRecurrenceEvent };
