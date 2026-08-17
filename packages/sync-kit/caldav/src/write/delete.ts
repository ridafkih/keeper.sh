import type { Result, WriteIntent, WriteOutcome } from "@keeper.sh/sync-protocol";
import { remoteRefAt } from "./create";
import { observedHeaders } from "./precondition";
import { preconditionFailed } from "./put";
import { absentStatuses, conditionalDelete } from "./remove";
import type { WriteSurroundings } from "./surroundings";

type RemovalIntent = Extract<WriteIntent<"caldav">, { kind: "delete" } | { kind: "retire" }>;

const absent = (status: number): boolean =>
  absentStatuses.some((candidate) => candidate === status);

const deleteResource = async (
  surroundings: WriteSurroundings,
  intent: RemovalIntent,
): Promise<Result<WriteOutcome>> => {
  const path = intent.target.value;
  const condition = observedHeaders(intent.precondition);
  if (condition.kind !== "ifMatch") {
    return { ok: true, value: { kind: "notAttempted", reason: "superseded" } };
  }
  const removed = await conditionalDelete(surroundings, path, condition);
  if (!removed.ok) {
    return { ok: false, failure: removed.failure };
  }
  if (absent(removed.value.status)) {
    return { ok: true, value: { kind: "alreadyAbsent", remote: remoteRefAt(path) } };
  }
  if (removed.value.status === preconditionFailed) {
    return {
      ok: true,
      value: {
        kind: "conflict",
        remote: remoteRefAt(path),
        observed: intent.precondition,
      },
    };
  }
  return { ok: true, value: { kind: "deleted", remote: remoteRefAt(path) } };
};

export { deleteResource };
