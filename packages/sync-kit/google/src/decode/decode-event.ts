import type { calendar_v3 } from "@googleapis/calendar";
import type {
  Availability,
  DeleteHandle,
  EditableContent,
  EventTime,
  EventUid,
  RecurrenceAnchor,
  RecurrencePayload,
  RemoteEventId,
  RemoteVersion,
  Revision,
  Visibility,
  WithholdReason,
} from "@keeper.sh/sync-protocol";
import { assertNever, availabilityKinds, visibilityKinds } from "@keeper.sh/sync-protocol";
import { isCancelledItem } from "./cancellation";
import type { DecodedTime } from "./event-time";
import { readEventType, verdictForEventType } from "./event-type";
import { decodeIdentity, revisionOfVersion } from "./identity";
import { decodeRecurrence } from "./recurrence";

type DecodedOccurrence =
  | { readonly kind: "single"; readonly time: EventTime }
  | {
      readonly kind: "series";
      readonly recurrence: RecurrencePayload;
      readonly anchor: RecurrenceAnchor;
    };

interface EventPatch {
  readonly title: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly availability: Availability;
  readonly visibility: Visibility;
  readonly occurrence: DecodedOccurrence;
  readonly uid: EventUid;
  readonly version: RemoteVersion;
  readonly revision: Revision;
}

type DecodedItem =
  | { readonly kind: "cancelled"; readonly id: RemoteEventId; readonly uid: EventUid | null }
  | {
      readonly kind: "patch";
      readonly id: RemoteEventId;
      readonly deleteHandle: DeleteHandle;
      readonly fields: EventPatch;
    }
  | {
      readonly kind: "undecodable";
      readonly id: RemoteEventId | null;
      readonly uid: EventUid | null;
      readonly reason: WithholdReason;
    };

type TimeDecoder = (
  start: calendar_v3.Schema$EventDateTime | null | undefined,
  end: calendar_v3.Schema$EventDateTime | null | undefined,
) => DecodedTime;

const unnamed: DecodedItem = {
  kind: "undecodable",
  id: null,
  uid: null,
  reason: "missingIdentity",
};

const withheld = (
  id: RemoteEventId | null,
  uid: EventUid | null,
  reason: WithholdReason,
): DecodedItem => ({ kind: "undecodable", id, uid, reason });

const availabilityOf = (
  item: calendar_v3.Schema$Event,
  declared: Availability,
): Availability => {
  if (item.transparency === "transparent") {
    return "free";
  }
  if (item.transparency === "opaque") {
    return "busy";
  }
  return availabilityKinds.find((kind) => kind === declared) ?? "busy";
};

const visibilityOf = (item: calendar_v3.Schema$Event): Visibility =>
  visibilityKinds.find((kind) => kind === item.visibility) ?? "default";

const occurrenceOf = (
  item: calendar_v3.Schema$Event,
  decodeTime: TimeDecoder,
): DecodedOccurrence | WithholdReason => {
  const recurrence = decodeRecurrence(item);
  switch (recurrence.kind) {
    case "recurring": {
      return { kind: "series", recurrence: recurrence.payload, anchor: recurrence.anchor };
    }
    case "undecodable": {
      return recurrence.reason;
    }
    case "none": {
      const decoded = decodeTime(item.start, item.end);
      if (decoded.kind === "undecodable") {
        return decoded.reason;
      }
      return { kind: "single", time: decoded.time };
    }
    default: {
      return assertNever(recurrence);
    }
  }
};

const carriesNoOccurrence = (item: calendar_v3.Schema$Event): boolean =>
  !item.start && !item.end && (item.recurrence ?? []).length === 0;

const isOccurrence = (
  decoded: DecodedOccurrence | WithholdReason,
): decoded is DecodedOccurrence => typeof decoded !== "string";

const decodeEvent = (item: calendar_v3.Schema$Event, decodeTime: TimeDecoder): DecodedItem => {
  const identity = decodeIdentity(item);
  if (identity === null) {
    return unnamed;
  }
  if (isCancelledItem(item)) {
    return { kind: "cancelled", id: identity.id, uid: identity.uid };
  }
  if (identity.uid === null || identity.version === null) {
    return withheld(identity.id, identity.uid, "missingIdentity");
  }
  if (carriesNoOccurrence(item)) {
    return withheld(identity.id, identity.uid, "unparseable");
  }
  const eventType = readEventType(item.eventType ?? "default");
  if (eventType === null) {
    return withheld(identity.id, identity.uid, "unparseable");
  }
  const verdict = verdictForEventType(eventType);
  if (verdict.kind === "withheld") {
    return withheld(identity.id, identity.uid, "unparseable");
  }
  const occurrence = occurrenceOf(item, decodeTime);
  if (!isOccurrence(occurrence)) {
    return withheld(identity.id, identity.uid, occurrence);
  }
  return {
    kind: "patch",
    id: identity.id,
    deleteHandle: identity.deleteHandle,
    fields: {
      title: item.summary ?? "",
      description: item.description ?? null,
      location: item.location ?? null,
      availability: availabilityOf(item, verdict.availability),
      visibility: visibilityOf(item),
      occurrence,
      uid: identity.uid,
      version: identity.version,
      revision: revisionOfVersion(identity.version),
    },
  };
};

const contentOfPatch = (fields: EventPatch): EditableContent => {
  const described = {
    title: fields.title,
    description: fields.description,
    location: fields.location,
    availability: fields.availability,
    visibility: fields.visibility,
  };
  const { occurrence } = fields;
  switch (occurrence.kind) {
    case "single": {
      return { ...described, recurrence: null, time: occurrence.time };
    }
    case "series": {
      return { ...described, recurrence: occurrence.recurrence, anchor: occurrence.anchor };
    }
    default: {
      return assertNever(occurrence);
    }
  }
};

export { contentOfPatch, decodeEvent };
export type { DecodedItem, DecodedOccurrence, EventPatch, TimeDecoder };
