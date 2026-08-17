import type {
  OperationContext,
  RemoteEventId,
  Result,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { graphEmpty } from "../client/graph-call";
import { enforcedPrecondition, matchesObserved } from "./precondition";
import {
  eventPathOf,
  mailboxesOf,
  readRemoteEvent,
  remoteRefOf,
  unreadableVersion,
  versionOfEvent,
  writeFailure,
} from "./remote";
import type { WriteSurroundings } from "./surroundings";

type Removing = Extract<WriteIntent<"microsoft">, { kind: "delete" } | { kind: "retire" }>;

const targetOf = (intent: Removing): RemoteEventId => ({
  kind: "remoteEventId",
  value: intent.target.value,
});

const spentPrecondition = async (
  intent: Removing,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const remote = remoteRefOf(intent.target.value);
  const fetched = await readRemoteEvent(intent.calendar, targetOf(intent), context, surroundings);
  switch (fetched.kind) {
    case "found": {
      const version = versionOfEvent(fetched.event);
      if (version === null) {
        return unreadableVersion;
      }
      return {
        ok: true,
        value: { kind: "conflict", remote, observed: { kind: "matchesVersion", version } },
      };
    }
    case "absent": {
      return { ok: true, value: { kind: "alreadyAbsent", remote } };
    }
    case "notAttempted": {
      return { ok: true, value: { kind: "notAttempted", reason: fetched.reason } };
    }
    case "failed": {
      return { ok: false, failure: writeFailure(fetched.failure, intent.calendar) };
    }
    default: {
      return assertNever(fetched);
    }
  }
};

const removedInGraph = async (
  intent: Removing,
  ifMatch: string,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const remote = remoteRefOf(intent.target.value);
  const answered = await surroundings.requests.send<null>({
    operation: "write",
    mailboxes: mailboxesOf(intent.calendar),
    context,
    send: (signal) =>
      graphEmpty(
        surroundings.dependencies.graph,
        {
          method: "delete",
          path: eventPathOf(intent.calendar, intent.target.value),
          headers: { "If-Match": ifMatch },
        },
        signal,
      ),
  });
  switch (answered.kind) {
    case "answered": {
      return { ok: true, value: { kind: "deleted", remote } };
    }
    case "notAttempted": {
      return { ok: true, value: { kind: "notAttempted", reason: answered.reason } };
    }
    case "failed": {
      if (answered.failure.kind === "notFound" || answered.failure.kind === "gone") {
        return { ok: true, value: { kind: "alreadyAbsent", remote } };
      }
      if (answered.failure.kind === "conflict") {
        return spentPrecondition(intent, context, surroundings);
      }
      return { ok: false, failure: writeFailure(answered.failure, intent.calendar) };
    }
    default: {
      return assertNever(answered);
    }
  }
};

const deleteInGraph = async (
  intent: Removing,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const precondition = enforcedPrecondition(intent.precondition);
  if (precondition.kind !== "enforced") {
    return { ok: false, failure: { kind: "unsupported", operation: "write" } };
  }
  const remote = remoteRefOf(intent.target.value);
  const current = await readRemoteEvent(intent.calendar, targetOf(intent), context, surroundings);
  switch (current.kind) {
    case "absent": {
      return { ok: true, value: { kind: "alreadyAbsent", remote } };
    }
    case "notAttempted": {
      return { ok: true, value: { kind: "notAttempted", reason: current.reason } };
    }
    case "failed": {
      return { ok: false, failure: writeFailure(current.failure, intent.calendar) };
    }
    case "found": {
      const observed = versionOfEvent(current.event);
      if (observed === null) {
        return unreadableVersion;
      }
      if (!matchesObserved(intent.precondition, observed)) {
        return {
          ok: true,
          value: { kind: "conflict", remote, observed: { kind: "matchesVersion", version: observed } },
        };
      }
      return removedInGraph(intent, precondition.ifMatch, context, surroundings);
    }
    default: {
      return assertNever(current);
    }
  }
};

export { deleteInGraph };
export type { Removing };
