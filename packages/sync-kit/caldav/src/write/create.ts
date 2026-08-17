import type {
  NormalizedContent,
  RemoteRef,
  RemoteVersion,
  Result,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { caldavFingerprint } from "../fingerprint";
import { putEchoVerdict, versionOfPut } from "./echo";
import { normalizeCalDAVContent } from "./normalize";
import { conditionalHeaders } from "./precondition";
import { conditionalPut, preconditionFailed } from "./put";
import { readRemoteEtag, readRemoteResource } from "./remote";
import { createdResourcePath, createdResourceUid, namesOneResource } from "./resource-url";
import { serializeResource } from "./serialize";
import type { WriteSurroundings } from "./surroundings";

type CreateIntent = Extract<WriteIntent<"caldav">, { kind: "create" }>;

const remoteRefAt = (path: string): RemoteRef => ({
  id: { kind: "remoteEventId", value: path },
  deleteHandle: { kind: "deleteHandle", value: path },
});

const versionAfterPut = async (
  surroundings: WriteSurroundings,
  path: string,
  etag: string | null,
): Promise<RemoteVersion> => {
  const carried = versionOfPut({ status: 0, etag });
  if (carried) {
    return carried;
  }
  const reread = await readRemoteEtag(surroundings, path);
  return { kind: "remoteVersion", value: reread ?? "" };
};

const resolvedCollision = async (
  surroundings: WriteSurroundings,
  path: string,
  normalized: NormalizedContent<"caldav">,
): Promise<Result<WriteOutcome>> => {
  const existing = await readRemoteResource(surroundings, path);
  if (!existing.ok) {
    return { ok: false, failure: existing.failure };
  }
  const remote = existing.value;
  if (remote.fingerprint.value === normalized.fingerprint.value) {
    return {
      ok: true,
      value: { kind: "alreadyExists", remote: remoteRefAt(path), version: remote.version },
    };
  }
  return {
    ok: true,
    value: {
      kind: "conflict",
      remote: remoteRefAt(path),
      observed: { kind: "matchesVersion", version: remote.version },
    },
  };
};

const createResource = async (
  surroundings: WriteSurroundings,
  intent: CreateIntent,
): Promise<Result<WriteOutcome>> => {
  const { dependencies } = surroundings.internals;
  if (!namesOneResource(intent.idempotencyKey)) {
    return { ok: false, failure: { kind: "unsupported", operation: "write" } };
  }
  const normalized = normalizeCalDAVContent(dependencies, intent.content.content);
  if (!normalized.ok) {
    if (normalized.failure.kind !== "unrepresentable") {
      return { ok: false, failure: normalized.failure };
    }
    return {
      ok: true,
      value: { kind: "unrepresentable", constraint: normalized.failure.constraint },
    };
  }
  const uid = createdResourceUid(intent.idempotencyKey);
  const serialised = serializeResource(dependencies, uid, normalized.value, null);
  switch (serialised.kind) {
    case "refused": {
      return { ok: true, value: { kind: "unrepresentable", constraint: serialised.constraint } };
    }
    case "uidMismatch": {
      return { ok: true, value: { kind: "unrepresentable", constraint: "recurrenceDialect" } };
    }
    case "resource": {
      break;
    }
    default: {
      return assertNever(serialised);
    }
  }
  const path = createdResourcePath(surroundings.collectionPath, intent.idempotencyKey);
  const condition = conditionalHeaders(intent.precondition);
  if (condition.kind !== "ifNoneMatch") {
    return { ok: true, value: { kind: "notAttempted", reason: "superseded" } };
  }
  const written = await conditionalPut(surroundings, path, serialised.text, condition);
  if (!written.ok) {
    return { ok: false, failure: written.failure };
  }
  if (written.value.status === preconditionFailed) {
    const carried: NormalizedContent<"caldav"> = {
      ...normalized.value,
      fingerprint: caldavFingerprint(normalized.value.content, dependencies.hash),
    };
    return resolvedCollision(surroundings, path, carried);
  }
  return {
    ok: true,
    value: {
      kind: "created",
      remote: remoteRefAt(path),
      version: await versionAfterPut(surroundings, path, written.value.etag),
      echo: putEchoVerdict(),
    },
  };
};

export { createResource, remoteRefAt, versionAfterPut };
