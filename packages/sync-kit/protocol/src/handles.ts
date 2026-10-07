type ProviderId = string;
type Revision = number;

interface AccountId {
  readonly kind: "accountId";
  readonly value: string;
}

interface CalendarId {
  readonly kind: "calendarId";
  readonly value: string;
}

interface InstallationId {
  readonly kind: "installationId";
  readonly value: string;
}

interface Instant {
  readonly kind: "instant";
  readonly value: string;
}

interface CalendarDate {
  readonly kind: "calendarDate";
  readonly value: string;
}

interface ZoneId {
  readonly kind: "zoneId";
  readonly value: string;
}

interface RemoteEventId {
  readonly kind: "remoteEventId";
  readonly value: string;
}

interface DeleteHandle {
  readonly kind: "deleteHandle";
  readonly value: string;
}

interface EventUid {
  readonly kind: "eventUid";
  readonly value: string;
}

interface RemoteVersion {
  readonly kind: "remoteVersion";
  readonly value: string;
}

interface Fingerprint {
  readonly kind: "fingerprint";
  readonly value: string;
}

interface IdempotencyKey {
  readonly kind: "idempotencyKey";
  readonly value: string;
}

export type {
  AccountId,
  CalendarDate,
  CalendarId,
  DeleteHandle,
  EventUid,
  Fingerprint,
  IdempotencyKey,
  InstallationId,
  Instant,
  ProviderId,
  RemoteEventId,
  RemoteVersion,
  Revision,
  ZoneId,
};
