import type {
  NormalizedContent,
  OperationContext,
  Result,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { Event as GraphEvent } from "@microsoft/microsoft-graph-types";
import { graphJson } from "../client/graph-call";
import { preferHeaders } from "../client/prefer";
import { contentOfGraphEvent } from "../decode/decode-event";
import { canonicalEncoding } from "../fingerprint";
import { echoVerdictOf } from "./echo";
import { normalizeForMicrosoft } from "./normalize";
import type { RemoteRead } from "./remote";
import {
  eventsPathOf,
  findByIdempotencyKey,
  isGraphEvent,
  mailboxesOf,
  remoteRefOf,
  unreadableVersion,
  versionOfEvent,
  writeFailure,
} from "./remote";
import { serializeForGraph } from "./serialize";
import type { WriteSurroundings } from "./surroundings";

type CreateIntent = Extract<WriteIntent<"microsoft">, { kind: "create" }>;

const matchesSubmission = (
  event: GraphEvent,
  shaped: NormalizedContent<"microsoft">,
  surroundings: WriteSurroundings,
): boolean => {
  const observed = contentOfGraphEvent(event, surroundings.zones);
  if (typeof observed === "string") {
    return false;
  }
  return canonicalEncoding(observed) === canonicalEncoding(shaped.content);
};

const resolvedExisting = (
  event: GraphEvent,
  shaped: NormalizedContent<"microsoft">,
  surroundings: WriteSurroundings,
): Result<WriteOutcome> => {
  const version = versionOfEvent(event);
  if (version === null || typeof event.id !== "string") {
    return unreadableVersion;
  }
  const remote = remoteRefOf(event.id);
  if (matchesSubmission(event, shaped, surroundings)) {
    return { ok: true, value: { kind: "alreadyExists", remote, version } };
  }
  return {
    ok: true,
    value: {
      kind: "conflict",
      remote,
      observed: { kind: "matchesVersion", version },
    },
  };
};

const bodyFor = (
  intent: CreateIntent,
  shaped: NormalizedContent<"microsoft">,
  surroundings: WriteSurroundings,
): GraphEvent =>
  serializeForGraph({
    content: shaped,
    provenance: intent.provenance,
    idempotencyKey: intent.idempotencyKey.value,
    preservedBody: null,
    existing: null,
    zones: surroundings.zones,
  });

const insertOnce = async (
  intent: CreateIntent,
  shaped: NormalizedContent<"microsoft">,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<RemoteRead> => {
  const { calendar } = intent;
  const answered = await surroundings.requests.send<unknown>({
    operation: "write",
    mailboxes: mailboxesOf(calendar),
    context,
    send: (signal) =>
      graphJson(
        surroundings.dependencies.graph,
        {
          method: "post",
          path: eventsPathOf(calendar),
          headers: preferHeaders(),
          body: bodyFor(intent, shaped, surroundings),
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

const createdFrom = (
  event: GraphEvent,
  shaped: NormalizedContent<"microsoft">,
): Result<WriteOutcome> => {
  const version = versionOfEvent(event);
  if (version === null || typeof event.id !== "string") {
    return unreadableVersion;
  }
  return {
    ok: true,
    value: {
      kind: "created",
      remote: remoteRefOf(event.id),
      version,
      echo: echoVerdictOf(shaped, event),
    },
  };
};

const insertedOutcome = async (
  intent: CreateIntent,
  shaped: NormalizedContent<"microsoft">,
  context: OperationContext,
  surroundings: WriteSurroundings,
  retryAfterDuplicate: boolean,
): Promise<Result<WriteOutcome>> => {
  const inserted = await insertOnce(intent, shaped, context, surroundings);
  switch (inserted.kind) {
    case "found": {
      return createdFrom(inserted.event, shaped);
    }
    case "absent": {
      return unreadableVersion;
    }
    case "notAttempted": {
      return { ok: true, value: { kind: "notAttempted", reason: inserted.reason } };
    }
    case "failed": {
      if (inserted.failure.kind !== "duplicate" || !retryAfterDuplicate) {
        return { ok: false, failure: writeFailure(inserted.failure, intent.calendar) };
      }
      const named = await findByIdempotencyKey(
        intent.calendar,
        intent.idempotencyKey,
        context,
        surroundings,
      );
      if (named.kind === "found") {
        return resolvedExisting(named.event, shaped, surroundings);
      }
      return insertedOutcome(intent, shaped, context, surroundings, false);
    }
    default: {
      return assertNever(inserted);
    }
  }
};

const createInGraph = async (
  intent: CreateIntent,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const shaped = normalizeForMicrosoft(intent.content.content, surroundings.dependencies.hash);
  if (!shaped.ok) {
    return { ok: false, failure: shaped.failure };
  }
  const existing = await findByIdempotencyKey(
    intent.calendar,
    intent.idempotencyKey,
    context,
    surroundings,
  );
  switch (existing.kind) {
    case "found": {
      return resolvedExisting(existing.event, shaped.value, surroundings);
    }
    case "failed": {
      return { ok: false, failure: writeFailure(existing.failure, intent.calendar) };
    }
    case "notAttempted": {
      return { ok: true, value: { kind: "notAttempted", reason: existing.reason } };
    }
    case "absent": {
      return insertedOutcome(intent, shaped.value, context, surroundings, true);
    }
    default: {
      return assertNever(existing);
    }
  }
};

export { createInGraph };
export type { CreateIntent };
