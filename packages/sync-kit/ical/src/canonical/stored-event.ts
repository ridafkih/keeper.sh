import type {
  Availability,
  CalendarDate,
  EditableContent,
  EventTime,
  EventUid,
  Instant,
  OccurrenceDuration,
  RecurrenceAnchor,
  RecurrencePayload,
  Visibility,
  ZoneId,
} from "@keeper.sh/sync-protocol";
import { availabilityKinds, visibilityKinds } from "@keeper.sh/sync-protocol";
import { IcsInternalDataError } from "../errors";
import type { EventIdentity } from "../parse/identity";
import type { CanonicalEvent } from "./canonical-event";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const refuse = (what: string): never => {
  throw new IcsInternalDataError(`a stored canonical event is unusable: ${what}`);
};

const requiredRecord = (value: unknown, what: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    return refuse(what);
  }
  return value;
};

const requiredString = (value: unknown, what: string): string => {
  if (typeof value !== "string") {
    return refuse(what);
  }
  return value;
};

const isAbsent = (value: unknown): boolean => (value ?? null) === null;

const optionalString = (value: unknown, what: string): string | null => {
  if (isAbsent(value)) {
    return null;
  }
  return requiredString(value, what);
};

const requiredArray = (value: unknown, what: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return refuse(what);
  }
  return value;
};

const handleOf = <Kind extends string>(value: unknown, kind: Kind, what: string): { kind: Kind; value: string } => {
  const record = requiredRecord(value, what);
  if (record["kind"] !== kind) {
    return refuse(what);
  }
  return { kind, value: requiredString(record["value"], what) };
};

const instantOf = (value: unknown, what: string): Instant => handleOf(value, "instant", what);
const calendarDateOf = (value: unknown, what: string): CalendarDate =>
  handleOf(value, "calendarDate", what);
const zoneOf = (value: unknown, what: string): ZoneId => handleOf(value, "zoneId", what);
const uidOf = (value: unknown, what: string): EventUid => handleOf(value, "eventUid", what);

const identityOf = (value: unknown): EventIdentity => {
  const record = requiredRecord(value, "identity");
  const uid = uidOf(record["uid"], "identity uid");
  switch (record["kind"]) {
    case "master": {
      return { kind: "master", uid };
    }
    case "override": {
      return {
        kind: "override",
        uid,
        recurrenceInstant: instantOf(record["recurrenceInstant"], "override instant"),
      };
    }
    case "slot": {
      return {
        kind: "slot",
        uid,
        start: instantOf(record["start"], "slot start"),
        end: instantOf(record["end"], "slot end"),
      };
    }
    default: {
      return refuse("identity kind");
    }
  }
};

const availabilityOf = (value: unknown): Availability => {
  const found = availabilityKinds.find((kind) => kind === value);
  if (!found) {
    return refuse("availability");
  }
  return found;
};

const visibilityOf = (value: unknown): Visibility => {
  const found = visibilityKinds.find((kind) => kind === value);
  if (!found) {
    return refuse("visibility");
  }
  return found;
};

const zoneOrNull = (value: unknown): ZoneId | null => {
  if (isAbsent(value)) {
    return null;
  }
  return zoneOf(value, "zone");
};

const numberOf = (value: unknown, what: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return refuse(what);
  }
  return value;
};

const durationOf = (value: unknown): OccurrenceDuration => {
  const record = requiredRecord(value, "duration");
  switch (record["kind"]) {
    case "exact": {
      return { kind: "exact", seconds: numberOf(record["seconds"], "duration seconds") };
    }
    case "nominal": {
      return { kind: "nominal", days: numberOf(record["days"], "duration days") };
    }
    default: {
      return refuse("duration kind");
    }
  }
};


const nominalDurationOf = (value: unknown): { readonly kind: "nominal"; readonly days: number } => {
  const duration = durationOf(value);
  if (duration.kind !== "nominal") {
    return refuse("anchor duration");
  }
  return duration;
};

const timeOf = (value: unknown): EventTime => {
  const record = requiredRecord(value, "time");
  switch (record["kind"]) {
    case "timed": {
      return {
        kind: "timed",
        start: instantOf(record["start"], "time start"),
        end: instantOf(record["end"], "time end"),
        zone: zoneOrNull(record["zone"]),
      };
    }
    case "allDay": {
      return {
        kind: "allDay",
        startDate: calendarDateOf(record["startDate"], "time start date"),
        endDateExclusive: calendarDateOf(record["endDateExclusive"], "time end date"),
      };
    }
    default: {
      return refuse("time kind");
    }
  }
};


const anchorOf = (value: unknown): RecurrenceAnchor => {
  const record = requiredRecord(value, "anchor");
  switch (record["kind"]) {
    case "timed": {
      return {
        kind: "timed",
        start: instantOf(record["start"], "anchor start"),
        zone: zoneOf(record["zone"], "anchor zone"),
        duration: durationOf(record["duration"]),
      };
    }
    case "allDay": {
      return {
        kind: "allDay",
        startDate: calendarDateOf(record["startDate"], "anchor start date"),
        duration: nominalDurationOf(record["duration"]),
      };
    }
    default: {
      return refuse("anchor kind");
    }
  }
};


const recurrenceOf = (value: unknown): RecurrencePayload => {
  const record = requiredRecord(value, "recurrence");
  if (record["dialect"] !== "rfc5545" && record["dialect"] !== "providerNative") {
    return refuse("recurrence dialect");
  }
  return {
    dialect: record["dialect"],
    value: requiredString(record["value"], "recurrence value"),
    exceptions: requiredArray(record["exceptions"], "recurrence exceptions").map((entry) =>
      requiredString(entry, "recurrence exception"),
    ),
  };
};

const contentOf = (value: unknown): EditableContent => {
  const record = requiredRecord(value, "content");
  const described = {
    title: requiredString(record["title"], "title"),
    description: optionalString(record["description"], "description"),
    location: optionalString(record["location"], "location"),
    availability: availabilityOf(record["availability"]),
    visibility: visibilityOf(record["visibility"]),
  };
  if (isAbsent(record["recurrence"])) {
    return { ...described, recurrence: null, time: timeOf(record["time"]) };
  }
  return {
    ...described,
    recurrence: recurrenceOf(record["recurrence"]),
    anchor: anchorOf(record["anchor"]),
  };
};

const parseStoredCanonicalEvent = (value: unknown): CanonicalEvent => {
  const record = requiredRecord(value, "payload");
  return {
    identity: identityOf(record["identity"]),
    content: contentOf(record["content"]),
    cancellations: requiredArray(record["cancellations"], "cancellations").map((entry) =>
      instantOf(entry, "cancellation"),
    ),
  };
};

export { parseStoredCanonicalEvent };
