import type {
  NormalizedContent,
  OperationContext,
  RemoteVersion,
  Result,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { Event as GraphEvent } from "@microsoft/microsoft-graph-types";
import { graphJson } from "../client/graph-call";
import { preferHeaders } from "../client/prefer";
import { echoVerdictOf } from "./echo";
import { normalizeForMicrosoft } from "./normalize";
import { splitBodyRegions } from "./online-meeting";
import { enforcedPrecondition, matchesObserved } from "./precondition";
import type { RemoteRead } from "./remote";
import {
  eventPathOf,
  isGraphEvent,
  mailboxesOf,
  readRemoteEvent,
  remoteRefOf,
  unreadableVersion,
  versionOfEvent,
  writeFailure,
} from "./remote";
import { serializeForGraph } from "./serialize";
import type { WriteSurroundings } from "./surroundings";

type UpdateIntent = Extract<WriteIntent<"microsoft">, { kind: "update" }>;

const conflictOn = (target: string, version: RemoteVersion): Result<WriteOutcome> => ({
  ok: true,
  value: {
    kind: "conflict",
    remote: remoteRefOf(target),
    observed: { kind: "matchesVersion", version },
  },
});

const spentPrecondition = async (
  intent: UpdateIntent,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const fetched = await readRemoteEvent(intent.calendar, intent.target, context, surroundings);
  switch (fetched.kind) {
    case "found": {
      const version = versionOfEvent(fetched.event);
      if (version === null) {
        return unreadableVersion;
      }
      return conflictOn(intent.target.value, version);
    }
    case "absent": {
      return { ok: true, value: { kind: "alreadyAbsent", remote: remoteRefOf(intent.target.value) } };
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

const patchOnce = async (
  intent: UpdateIntent,
  shaped: NormalizedContent<"microsoft">,
  existing: GraphEvent,
  ifMatch: string,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<RemoteRead> => {
  const answered = await surroundings.requests.send<unknown>({
    operation: "write",
    mailboxes: mailboxesOf(intent.calendar),
    context,
    send: (signal) =>
      graphJson(
        surroundings.dependencies.graph,
        {
          method: "patch",
          path: eventPathOf(intent.calendar, intent.target.value),
          headers: { ...preferHeaders(), "If-Match": ifMatch },
          body: serializeForGraph({
            content: shaped,
            provenance: null,
            idempotencyKey: null,
            preservedBody: splitBodyRegions(existing).providerOwned,
            existing,
            zones: surroundings.zones,
          }),
        },
        signal,
      ),
  });
  switch (answered.kind) {
    case "answered": {
      if (!isGraphEvent(answered.value)) {
        return { kind: "absent" };
      }
      return { kind: "found", event: answered.value };
    }
    case "failed": {
      return { kind: "failed", failure: answered.failure };
    }
    case "notAttempted": {
      return { kind: "notAttempted", reason: answered.reason };
    }
    default: {
      return assertNever(answered);
    }
  }
};

const appliedPatch = async (
  intent: UpdateIntent,
  shaped: NormalizedContent<"microsoft">,
  existing: GraphEvent,
  ifMatch: string,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const patched = await patchOnce(intent, shaped, existing, ifMatch, context, surroundings);
  switch (patched.kind) {
    case "found": {
      const version = versionOfEvent(patched.event);
      if (version === null) {
        return unreadableVersion;
      }
      return {
        ok: true,
        value: {
          kind: "updated",
          remote: remoteRefOf(intent.target.value),
          version,
          echo: echoVerdictOf(shaped, patched.event),
        },
      };
    }
    case "absent": {
      return unreadableVersion;
    }
    case "notAttempted": {
      return { ok: true, value: { kind: "notAttempted", reason: patched.reason } };
    }
    case "failed": {
      if (patched.failure.kind === "conflict" || patched.failure.kind === "duplicate") {
        return spentPrecondition(intent, context, surroundings);
      }
      if (patched.failure.kind === "notFound" || patched.failure.kind === "gone") {
        return {
          ok: true,
          value: { kind: "alreadyAbsent", remote: remoteRefOf(intent.target.value) },
        };
      }
      return { ok: false, failure: writeFailure(patched.failure, intent.calendar) };
    }
    default: {
      return assertNever(patched);
    }
  }
};

const updateInGraph = async (
  intent: UpdateIntent,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const shaped = normalizeForMicrosoft(intent.content.content, surroundings.dependencies.hash);
  if (!shaped.ok) {
    return { ok: false, failure: shaped.failure };
  }
  const precondition = enforcedPrecondition(intent.precondition);
  if (precondition.kind !== "enforced") {
    return { ok: false, failure: { kind: "unsupported", operation: "write" } };
  }
  const current = await readRemoteEvent(intent.calendar, intent.target, context, surroundings);
  switch (current.kind) {
    case "absent": {
      return {
        ok: true,
        value: { kind: "alreadyAbsent", remote: remoteRefOf(intent.target.value) },
      };
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
        return conflictOn(intent.target.value, observed);
      }
      return appliedPatch(
        intent,
        shaped.value,
        current.event,
        precondition.ifMatch,
        context,
        surroundings,
      );
    }
    default: {
      return assertNever(current);
    }
  }
};

export { updateInGraph };
export type { UpdateIntent };
