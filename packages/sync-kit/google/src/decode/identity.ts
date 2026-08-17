import type { calendar_v3 } from "@googleapis/calendar";
import type {
  DeleteHandle,
  EventUid,
  RemoteEventId,
  RemoteVersion,
  Revision,
} from "@keeper.sh/sync-protocol";
import { instanceUidSuffix, originalStartOf } from "./instance-key";

const mirroredUidPropertyKey = "keeper.sh/uid";

interface DecodedIdentity {
  readonly id: RemoteEventId;
  readonly deleteHandle: DeleteHandle;
  readonly uid: EventUid | null;
  readonly version: RemoteVersion | null;
}

const nonEmpty = (value: string | null | undefined): string | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
};

const versionOfEtag = (etag: string | null | undefined): RemoteVersion | null => {
  const named = nonEmpty(etag);
  if (named === null) {
    return null;
  }
  const unquoted = named.replace(/^W\//, "").replaceAll('"', "");
  if (unquoted.length === 0) {
    return null;
  }
  return { kind: "remoteVersion", value: unquoted };
};

const revisionOfVersion = (version: RemoteVersion): Revision => {
  const digits = /\d+/.exec(version.value);
  if (!digits) {
    return 1;
  }
  return Number.parseInt(digits[0], 10);
};

const mirroredUidOf = (item: calendar_v3.Schema$Event): string | null =>
  nonEmpty(item.extendedProperties?.private?.[mirroredUidPropertyKey]);

const isSeriesInstance = (item: calendar_v3.Schema$Event): boolean =>
  nonEmpty(item.recurringEventId) !== null;

const uidOf = (item: calendar_v3.Schema$Event): EventUid | null => {
  const named = mirroredUidOf(item) ?? nonEmpty(item.iCalUID);
  if (named === null) {
    return null;
  }
  const start = originalStartOf(item);
  if (start === null || !isSeriesInstance(item)) {
    return { kind: "eventUid", value: named };
  }
  return { kind: "eventUid", value: `${named}${instanceUidSuffix(start)}` };
};

const decodeIdentity = (item: calendar_v3.Schema$Event): DecodedIdentity | null => {
  const id = nonEmpty(item.id);
  if (id === null) {
    return null;
  }
  return {
    id: { kind: "remoteEventId", value: id },
    deleteHandle: { kind: "deleteHandle", value: id },
    uid: uidOf(item),
    version: versionOfEtag(item.etag),
  };
};

export { decodeIdentity, mirroredUidPropertyKey, revisionOfVersion, versionOfEtag };
export type { DecodedIdentity };
