import type {
  Availability,
  CalendarKey,
  DescribedContent,
  EditableContent,
  EventUid,
  InstallationId,
  Provenance,
  RemoteEvent,
  RemoteEventFacts,
  RemoteEventId,
  Visibility,
  WithheldIdentity,
  WithholdReason,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { ZoneCache } from "@keeper.sh/sync-ical";
import type { Event as GraphEvent } from "@microsoft/microsoft-graph-types";
import type { ListingMode } from "../cursor/fingerprint";
import { microsoftFingerprint } from "../fingerprint";
import { readBody } from "./body";
import { isCancelled } from "./cancellation";
import { decodeEventTime } from "./event-time";
import type { GraphEventType } from "./event-type";
import { readEventType } from "./event-type";
import type { EventIdentity } from "./identity";
import { readIdentity, revisionOfVersion } from "./identity";
import { resolveOriginalZone } from "./original-zone";
import { readProvenance } from "./provenance";
import { readRecurrence } from "./recurrence";
import type { RemovedReading } from "./removed";
import { readRemoved } from "./removed";

interface DecodeSurroundings {
  readonly calendar: CalendarKey;
  readonly installation: InstallationId;
  readonly zones: ZoneCache;
  readonly hash: (input: string) => string;
  readonly mode: ListingMode;
}

interface DecodedFields {
  readonly lastModifiedDateTime: string | null;
  readonly createdDateTime: string | null;
}

type DecodedItem =
  | {
      readonly kind: "decoded";
      readonly event: RemoteEvent;
      readonly type: GraphEventType;
      readonly fields: DecodedFields;
    }
  | {
      readonly kind: "tombstone";
      readonly removal: RemovedReading;
      readonly uid: EventUid | null;
    }
  | {
      readonly kind: "undecodable";
      readonly identity: WithheldIdentity;
      readonly reason: WithholdReason;
    }
  | { readonly kind: "discarded" };

const discarded: DecodedItem = { kind: "discarded" };

const isGraphEvent = (value: unknown): value is GraphEvent =>
  typeof value === "object" && value !== null;

const withheldOf = (
  uid: EventUid | null,
  id: RemoteEventId | null,
  reason: WithholdReason,
): DecodedItem => {
  if (uid !== null) {
    return { kind: "undecodable", identity: { uid, id }, reason };
  }
  if (id === null) {
    return discarded;
  }
  return { kind: "undecodable", identity: { uid: null, id }, reason };
};

const identifierOf = (event: GraphEvent): RemoteEventId | null => {
  const { id } = event;
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  return { kind: "remoteEventId", value: id };
};

const carriesASpan = (event: GraphEvent): boolean => {
  const startNamed = typeof event.start?.dateTime === "string";
  const endNamed = typeof event.end?.dateTime === "string";
  return startNamed && endNamed;
};

const availabilityOf = (event: GraphEvent): Availability => {
  if (event.showAs === "free" || event.showAs === "workingElsewhere") {
    return "free";
  }
  return "busy";
};

const visibilityOf = (event: GraphEvent): Visibility => {
  if (event.sensitivity === "private" || event.sensitivity === "confidential") {
    return "private";
  }
  return "default";
};

const emptyToNull = (value: string | null | undefined): string | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
};

const descriptionOf = (event: GraphEvent): string | null => {
  const body = readBody(event.body ?? null);
  if (body.kind !== "comparable") {
    return null;
  }
  return emptyToNull(body.text);
};

const describedOf = (event: GraphEvent): DescribedContent => ({
  title: event.subject ?? "",
  description: descriptionOf(event),
  location: emptyToNull(event.location?.displayName),
  availability: availabilityOf(event),
  visibility: visibilityOf(event),
});

const typeOf = (event: GraphEvent): GraphEventType | null => {
  const reading = readEventType(event.type);
  switch (reading.kind) {
    case "known": {
      return reading.type;
    }
    case "absent": {
      return "singleInstance";
    }
    case "unknown": {
      return null;
    }
    default: {
      return assertNever(reading);
    }
  }
};

const withProvenance = (facts: RemoteEventFacts, provenance: Provenance): RemoteEvent => {
  switch (provenance.kind) {
    case "ours": {
      return { ...facts, provenance };
    }
    case "foreign": {
      return { ...facts, provenance };
    }
    case "indeterminate": {
      return { ...facts, provenance };
    }
    default: {
      return assertNever(provenance);
    }
  }
};

const factsOf = (
  identity: EventIdentity,
  content: EditableContent,
  surroundings: DecodeSurroundings,
): RemoteEventFacts => ({
  id: identity.id,
  deleteHandle: identity.deleteHandle,
  uid: identity.uid,
  calendar: surroundings.calendar,
  revision: revisionOfVersion(identity.version),
  version: identity.version,
  content,
  fingerprint: microsoftFingerprint(content, surroundings.hash),
});

const contentOfGraphEvent = (
  event: GraphEvent,
  zones: ZoneCache,
): EditableContent | WithholdReason => {
  const zone = resolveOriginalZone(
    {
      originalStartTimeZone: event.originalStartTimeZone ?? null,
      responseTimeZone: event.start?.timeZone ?? null,
    },
    zones,
  );
  if (zone.kind === "unresolvable") {
    return "unresolvableTimeZone";
  }
  const time = decodeEventTime({
    start: event.start ?? null,
    end: event.end ?? null,
    isAllDay: event.isAllDay === true,
    zone: zone.zone,
    zones,
  });
  if (time.kind === "unrepresentable") {
    return "unrepresentableTime";
  }
  const described = describedOf(event);
  const recurrence = readRecurrence(event, time.time);
  switch (recurrence.kind) {
    case "single": {
      return { ...described, recurrence: null, time: time.time };
    }
    case "recurring": {
      return {
        ...described,
        recurrence: recurrence.reading.payload,
        anchor: recurrence.reading.anchor,
      };
    }
    case "unrepresentable": {
      return "unsupportedRecurrenceRange";
    }
    default: {
      return assertNever(recurrence);
    }
  }
};

const isContent = (value: EditableContent | WithholdReason): value is EditableContent =>
  typeof value !== "string";

const decodeGraphItem = (item: unknown, surroundings: DecodeSurroundings): DecodedItem => {
  const removal = readRemoved(item);
  if (removal.kind !== "notRemoved") {
    return { kind: "tombstone", removal, uid: null };
  }
  if (!isGraphEvent(item)) {
    return discarded;
  }
  const identifier = identifierOf(item);
  if (!carriesASpan(item)) {
    return withheldOf(null, identifier, "unparseable");
  }
  const reading = readIdentity(item);
  if (reading.kind === "missingIdentity") {
    return withheldOf(null, reading.id, "missingIdentity");
  }
  const { identity } = reading;
  if (isCancelled(item)) {
    return { kind: "tombstone", removal: { kind: "cancelled", id: identity.id }, uid: identity.uid };
  }
  const type = typeOf(item);
  if (type === null) {
    return withheldOf(identity.uid, identity.id, "unparseable");
  }
  const content = contentOfGraphEvent(item, surroundings.zones);
  if (!isContent(content)) {
    return withheldOf(identity.uid, identity.id, content);
  }
  return {
    kind: "decoded",
    event: withProvenance(
      factsOf(identity, content, surroundings),
      readProvenance(item, surroundings.installation),
    ),
    type,
    fields: {
      lastModifiedDateTime: emptyToNull(item.lastModifiedDateTime),
      createdDateTime: emptyToNull(item.createdDateTime),
    },
  };
};

export { contentOfGraphEvent, decodeGraphItem };
export type { DecodedFields, DecodedItem, DecodeSurroundings };
