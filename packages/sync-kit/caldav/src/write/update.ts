import type { Result, WriteIntent, WriteOutcome } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { remoteRefAt, versionAfterPut } from "./create";
import { putEchoVerdict } from "./echo";
import { normalizeCalDAVContent } from "./normalize";
import { observedHeaders } from "./precondition";
import { conditionalPut, preconditionFailed } from "./put";
import { readRemoteResource } from "./remote";
import { serializeResource } from "./serialize";
import type { WriteSurroundings } from "./surroundings";

type UpdateIntent = Extract<WriteIntent<"caldav">, { kind: "update" }>;

const staleAgainst = (intent: UpdateIntent, version: string): boolean => {
  if (intent.precondition.kind !== "matchesVersion") {
    return false;
  }
  if (version.length === 0 || intent.precondition.version.value.length === 0) {
    return true;
  }
  return intent.precondition.version.value !== version;
};

const updateResource = async (
  surroundings: WriteSurroundings,
  intent: UpdateIntent,
): Promise<Result<WriteOutcome>> => {
  const { dependencies } = surroundings.internals;
  const path = intent.target.value;
  const existing = await readRemoteResource(surroundings, path);
  if (!existing.ok) {
    return { ok: false, failure: existing.failure };
  }
  const remote = existing.value;
  if (staleAgainst(intent, remote.version.value)) {
    return {
      ok: true,
      value: {
        kind: "conflict",
        remote: remoteRefAt(path),
        observed: { kind: "matchesVersion", version: remote.version },
      },
    };
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
  if (normalized.value.fingerprint.value === remote.fingerprint.value) {
    return {
      ok: true,
      value: { kind: "unchanged", remote: remoteRefAt(path), version: remote.version },
    };
  }
  const serialised = serializeResource(dependencies, remote.uid, normalized.value, remote.revision);
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
  const condition = observedHeaders(intent.precondition);
  if (condition.kind !== "ifMatch") {
    return { ok: true, value: { kind: "notAttempted", reason: "superseded" } };
  }
  const written = await conditionalPut(surroundings, path, serialised.text, condition);
  if (!written.ok) {
    return { ok: false, failure: written.failure };
  }
  if (written.value.status === preconditionFailed) {
    return {
      ok: true,
      value: {
        kind: "conflict",
        remote: remoteRefAt(path),
        observed: { kind: "matchesVersion", version: remote.version },
      },
    };
  }
  return {
    ok: true,
    value: {
      kind: "updated",
      remote: remoteRefAt(path),
      version: await versionAfterPut(surroundings, path, written.value.etag),
      echo: putEchoVerdict(),
    },
  };
};

export { updateResource };
