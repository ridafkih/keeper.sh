import type {
  NormalizedContent,
  OperationContext,
  ProviderFailure,
  Result,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { versionOfEtag } from "../decode/identity";
import { echoVerdict } from "./echo";
import { deterministicEventId } from "./event-id";
import { normalizeForGoogle } from "./normalize";
import { fetchEvent, remoteRefOf, writeFailure } from "./remote";
import { serializeEvent } from "./serialize";
import type { WriteSurroundings } from "./surroundings";

type CreateIntent = Extract<WriteIntent<"google">, { kind: "create" }>;

const unobservedVersion: ProviderFailure = {
  kind: "transport",
  status: null,
  disposition: "permanent",
};

const resolveDuplicate = async (
  intent: CreateIntent,
  eventId: string,
  shaped: NormalizedContent<"google">,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const remote = remoteRefOf(eventId);
  const fetched = await fetchEvent(intent.calendar.key, eventId, context, surroundings);
  switch (fetched.kind) {
    case "absent": {
      return { ok: false, failure: unobservedVersion };
    }
    case "failed": {
      return { ok: false, failure: writeFailure(fetched.failure, intent.calendar.key) };
    }
    case "notAttempted": {
      return { ok: true, value: { kind: "notAttempted", reason: fetched.reason } };
    }
    case "found": {
      const { state } = fetched;
      if (state.fingerprint?.value === shaped.fingerprint.value) {
        return { ok: true, value: { kind: "alreadyExists", remote, version: state.version } };
      }
      return {
        ok: true,
        value: {
          kind: "conflict",
          remote,
          observed: { kind: "matchesVersion", version: state.version },
        },
      };
    }
    default: {
      return assertNever(fetched);
    }
  }
};

const insertEvent = async (
  intent: CreateIntent,
  eventId: string,
  shaped: NormalizedContent<"google">,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const body = {
    ...serializeEvent(shaped, {
      installation: intent.provenance.installation,
      uid: intent.idempotencyKey.value,
    }),
    id: eventId,
  };
  const answered = await surroundings.requests.send("write", context, (signal) =>
    surroundings.dependencies.calendar.events.insert(
      { calendarId: intent.calendar.key.calendar.value, requestBody: body },
      { signal },
    ),
  );
  switch (answered.kind) {
    case "notAttempted": {
      return { ok: true, value: { kind: "notAttempted", reason: answered.reason } };
    }
    case "failed": {
      if (answered.failure.kind === "conflict") {
        return resolveDuplicate(intent, eventId, shaped, context, surroundings);
      }
      return { ok: false, failure: writeFailure(answered.failure, intent.calendar.key) };
    }
    case "answered": {
      const returned = answered.value.data;
      const version = versionOfEtag(returned.etag);
      if (version === null) {
        return { ok: false, failure: unobservedVersion };
      }
      return {
        ok: true,
        value: {
          kind: "created",
          remote: remoteRefOf(eventId),
          version,
          echo: echoVerdict(shaped, returned, surroundings.dependencies.hash),
        },
      };
    }
    default: {
      return assertNever(answered);
    }
  }
};

const createEvent = (
  intent: CreateIntent,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const { hash } = surroundings.dependencies;
  const shaped = normalizeForGoogle(intent.content.content, hash);
  if (!shaped.ok) {
    return Promise.resolve({ ok: false, failure: shaped.failure });
  }
  const eventId = deterministicEventId(intent.idempotencyKey, intent.calendar.key.calendar, hash);
  if (eventId.kind === "outOfRange") {
    return Promise.resolve({ ok: false, failure: { kind: "unsupported", operation: "write" } });
  }
  surroundings.mintedIds.remember(eventId.value);
  return insertEvent(intent, eventId.value, shaped.value, context, surroundings);
};

export { createEvent };
export type { CreateIntent, WriteSurroundings };
