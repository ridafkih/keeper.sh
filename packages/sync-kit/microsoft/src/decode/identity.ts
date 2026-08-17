import type {
  DeleteHandle,
  EventUid,
  RemoteEventId,
  RemoteVersion,
  Revision,
} from "@keeper.sh/sync-protocol";
import type { Event as GraphEvent } from "@microsoft/microsoft-graph-types";
import { extendedPropertyValue, mirroredUidPropertyName } from "./extended-property";

interface EventIdentity {
  readonly id: RemoteEventId;
  readonly deleteHandle: DeleteHandle;
  readonly uid: EventUid;
  readonly version: RemoteVersion;
  readonly seriesMasterId: RemoteEventId | null;
}

type IdentityReading =
  | { readonly kind: "identified"; readonly identity: EventIdentity }
  | { readonly kind: "missingIdentity"; readonly id: RemoteEventId | null };

const nonEmpty = (value: string | null | undefined): string | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
};

const unquoted = (value: string): string => value.replace(/^W\//, "").replaceAll('"', "");

const versionOf = (event: GraphEvent): RemoteVersion | null => {
  const named = nonEmpty(event.changeKey);
  if (named === null) {
    return null;
  }
  const value = unquoted(named);
  if (value.length === 0) {
    return null;
  }
  return { kind: "remoteVersion", value };
};

const revisionOfVersion = (version: RemoteVersion): Revision => {
  const digits = /\d+/.exec(version.value);
  if (!digits) {
    return 1;
  }
  return Number.parseInt(digits[0], 10);
};

const uidOf = (event: GraphEvent, id: string): EventUid | null => {
  const mirrored = nonEmpty(extendedPropertyValue(event, mirroredUidPropertyName));
  if (mirrored !== null) {
    return { kind: "eventUid", value: mirrored };
  }
  const { iCalUId } = event;
  if (typeof iCalUId !== "string") {
    return { kind: "eventUid", value: id };
  }
  const named = nonEmpty(iCalUId);
  if (named === null) {
    return null;
  }
  return { kind: "eventUid", value: named };
};

const seriesMasterIdOf = (event: GraphEvent): RemoteEventId | null => {
  const named = nonEmpty(event.seriesMasterId);
  if (named === null) {
    return null;
  }
  return { kind: "remoteEventId", value: named };
};

const readIdentity = (event: GraphEvent): IdentityReading => {
  const named = nonEmpty(event.id);
  if (named === null) {
    return { kind: "missingIdentity", id: null };
  }
  const id: RemoteEventId = { kind: "remoteEventId", value: named };
  const uid = uidOf(event, named);
  const version = versionOf(event);
  if (uid === null || version === null) {
    return { kind: "missingIdentity", id };
  }
  return {
    kind: "identified",
    identity: {
      id,
      deleteHandle: { kind: "deleteHandle", value: named },
      uid,
      version,
      seriesMasterId: seriesMasterIdOf(event),
    },
  };
};

export { readIdentity, revisionOfVersion };
export type { EventIdentity, IdentityReading };
