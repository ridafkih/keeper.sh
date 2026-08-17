import type {
  OperationContext,
  Result,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { ifMatchHeader } from "./precondition";
import { fetchEvent, remoteRefOf, writeFailure } from "./remote";
import type { WriteSurroundings } from "./surroundings";

type RemovalIntent = Extract<WriteIntent<"google">, { kind: "delete" } | { kind: "retire" }>;

const spentPrecondition = async (
  intent: RemovalIntent,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const remote = remoteRefOf(intent.target.value);
  const fetched = await fetchEvent(
    intent.calendar.key,
    intent.target.value,
    context,
    surroundings,
  );
  switch (fetched.kind) {
    case "found": {
      return {
        ok: true,
        value: {
          kind: "conflict",
          remote,
          observed: { kind: "matchesVersion", version: fetched.state.version },
        },
      };
    }
    case "absent": {
      return { ok: true, value: { kind: "alreadyAbsent", remote } };
    }
    case "notAttempted": {
      return { ok: true, value: { kind: "notAttempted", reason: fetched.reason } };
    }
    case "failed": {
      return { ok: false, failure: writeFailure(fetched.failure, intent.calendar.key) };
    }
    default: {
      return assertNever(fetched);
    }
  }
};

const removeEvent = async (
  intent: RemovalIntent,
  headers: Record<string, string>,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const remote = remoteRefOf(intent.target.value);
  const answered = await surroundings.requests.send("write", context, (signal) =>
    surroundings.dependencies.calendar.events.delete(
      { calendarId: intent.calendar.key.calendar.value, eventId: intent.target.value },
      { headers, signal },
    ),
  );
  switch (answered.kind) {
    case "notAttempted": {
      return { ok: true, value: { kind: "notAttempted", reason: answered.reason } };
    }
    case "answered": {
      return { ok: true, value: { kind: "deleted", remote } };
    }
    case "failed": {
      if (answered.failure.kind === "preconditionFailed") {
        return spentPrecondition(intent, context, surroundings);
      }
      if (answered.failure.kind === "resourceGone" || answered.failure.kind === "notFound") {
        return { ok: true, value: { kind: "alreadyAbsent", remote } };
      }
      return { ok: false, failure: writeFailure(answered.failure, intent.calendar.key) };
    }
    default: {
      return assertNever(answered);
    }
  }
};

const deleteEvent = (
  intent: RemovalIntent,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const precondition = ifMatchHeader(intent.precondition);
  if (precondition.kind === "unsupported") {
    return Promise.resolve({ ok: false, failure: { kind: "unsupported", operation: "write" } });
  }
  return removeEvent(intent, precondition.headers, context, surroundings);
};

export { deleteEvent };
export type { RemovalIntent };
