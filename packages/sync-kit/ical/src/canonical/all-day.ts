import type { EventTime, Instant, ZoneId } from "@keeper.sh/sync-protocol";
import { wallClockFieldsAt } from "../zone/offset";
import { instantOf } from "../zone/wall-time";
import type { ZoneCache } from "../zone/zone-cache";

interface RecurrenceIdentitySet {
  readonly start: Instant;
  readonly exceptions: readonly Instant[];
  readonly overrideInstants: readonly Instant[];
  readonly until: Instant | null;
}

const resolveIsAllDay = (time: EventTime): boolean => time.kind === "allDay";

const utcMidnightOfLocalDay = (instant: Instant, zone: ZoneId, zones: ZoneCache): Instant => {
  const fields = wallClockFieldsAt(zones, zone.value, Date.parse(instant.value));
  return instantOf(Date.UTC(fields.year, fields.month - 1, fields.day));
};

const reanchoredUntil = (
  until: Instant | null,
  zone: ZoneId,
  zones: ZoneCache,
): Instant | null => {
  if (!until) {
    return null;
  }
  return utcMidnightOfLocalDay(until, zone, zones);
};

const reanchorRecurrenceIdentities = (
  identities: RecurrenceIdentitySet,
  zone: ZoneId,
  zones: ZoneCache,
): RecurrenceIdentitySet => ({
  start: utcMidnightOfLocalDay(identities.start, zone, zones),
  exceptions: identities.exceptions.map((instant) => utcMidnightOfLocalDay(instant, zone, zones)),
  overrideInstants: identities.overrideInstants.map((instant) =>
    utcMidnightOfLocalDay(instant, zone, zones),
  ),
  until: reanchoredUntil(identities.until, zone, zones),
});

export { reanchorRecurrenceIdentities, resolveIsAllDay };
export type { RecurrenceIdentitySet };
