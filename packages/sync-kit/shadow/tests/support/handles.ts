import type {
  AccountId,
  CalendarDate,
  CalendarId,
  DeleteHandle,
  EventUid,
  Fingerprint,
  IdempotencyKey,
  InstallationId,
  Instant,
  RemoteEventId,
  RemoteVersion,
  ZoneId,
} from "@keeper.sh/sync-protocol";

const instant = (value: string): Instant => ({ kind: "instant", value });
const calendarDate = (value: string): CalendarDate => ({ kind: "calendarDate", value });
const zone = (value: string): ZoneId => ({ kind: "zoneId", value });
const uid = (value: string): EventUid => ({ kind: "eventUid", value });
const remoteId = (value: string): RemoteEventId => ({ kind: "remoteEventId", value });
const deleteHandle = (value: string): DeleteHandle => ({ kind: "deleteHandle", value });
const version = (value: string): RemoteVersion => ({ kind: "remoteVersion", value });
const fingerprint = (value: string): Fingerprint => ({ kind: "fingerprint", value });
const installation = (value: string): InstallationId => ({ kind: "installationId", value });
const idempotencyKey = (value: string): IdempotencyKey => ({ kind: "idempotencyKey", value });
const accountId = (value: string): AccountId => ({ kind: "accountId", value });
const calendarId = (value: string): CalendarId => ({ kind: "calendarId", value });

export {
  accountId,
  calendarDate,
  calendarId,
  deleteHandle,
  fingerprint,
  idempotencyKey,
  installation,
  instant,
  remoteId,
  uid,
  version,
  zone,
};
