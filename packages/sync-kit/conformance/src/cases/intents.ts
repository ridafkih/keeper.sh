import type {
  CalendarKey,
  Capabilities,
  EditableContent,
  InstallationId,
  ProviderId,
  RemoteVersion,
  WriteIntent,
} from "@keeper.sh/sync-protocol";

const writableOf = (calendar: CalendarKey): WriteIntent["calendar"] => ({
  key: calendar,
  access: "readWrite",
});

const createIntent = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
  calendar: CalendarKey,
  installation: InstallationId,
  key: string,
  content: EditableContent,
): WriteIntent<Provider> => ({
  kind: "create",
  calendar: writableOf(calendar),
  idempotencyKey: { kind: "idempotencyKey", value: key },
  content: {
    kind: "normalized",
    provider: supports.provider,
    content,
    fingerprint: { kind: "fingerprint", value: `submitted-${key}` },
  },
  provenance: { kind: "ours", installation },
  precondition: { kind: "absent" },
});

const updateIntent = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
  calendar: CalendarKey,
  target: string,
  content: EditableContent,
  version: RemoteVersion,
): WriteIntent<Provider> => ({
  kind: "update",
  calendar: writableOf(calendar),
  target: { kind: "remoteEventId", value: target },
  content: {
    kind: "normalized",
    provider: supports.provider,
    content,
    fingerprint: { kind: "fingerprint", value: `submitted-${target}` },
  },
  precondition: { kind: "matchesVersion", version },
});

const deleteIntent = <Provider extends ProviderId>(
  calendar: CalendarKey,
  handle: string,
  version: RemoteVersion,
): WriteIntent<Provider> => ({
  kind: "delete",
  calendar: writableOf(calendar),
  target: { kind: "deleteHandle", value: handle },
  precondition: { kind: "matchesVersion", version },
  reason: "sourceDeleted",
});

export { createIntent, deleteIntent, updateIntent, writableOf };
