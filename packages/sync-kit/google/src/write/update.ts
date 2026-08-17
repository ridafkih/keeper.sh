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
import { normalizeForGoogle } from "./normalize";
import { ifMatchHeader } from "./precondition";
import { fetchEvent, remoteRefOf, writeFailure } from "./remote";
import { patchBodyOf } from "./serialize";
import type { WriteSurroundings } from "./surroundings";

type UpdateIntent = Extract<WriteIntent<"google">, { kind: "update" }>;

const unobservedVersion: ProviderFailure = {
  kind: "transport",
  status: null,
  disposition: "permanent",
};

const spentPrecondition = async (
  intent: UpdateIntent,
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

const patchEvent = async (
  intent: UpdateIntent,
  shaped: NormalizedContent<"google">,
  headers: Record<string, string>,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const answered = await surroundings.requests.send("write", context, (signal) =>
    surroundings.dependencies.calendar.events.patch(
      {
        calendarId: intent.calendar.key.calendar.value,
        eventId: intent.target.value,
        requestBody: patchBodyOf(shaped),
      },
      { headers, signal },
    ),
  );
  switch (answered.kind) {
    case "notAttempted": {
      return { ok: true, value: { kind: "notAttempted", reason: answered.reason } };
    }
    case "failed": {
      if (answered.failure.kind === "preconditionFailed") {
        return spentPrecondition(intent, context, surroundings);
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
          kind: "updated",
          remote: remoteRefOf(intent.target.value),
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

const updateEvent = (
  intent: UpdateIntent,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  const shaped = normalizeForGoogle(intent.content.content, surroundings.dependencies.hash);
  if (!shaped.ok) {
    return Promise.resolve({ ok: false, failure: shaped.failure });
  }
  const precondition = ifMatchHeader(intent.precondition);
  if (precondition.kind === "unsupported") {
    return Promise.resolve({ ok: false, failure: { kind: "unsupported", operation: "write" } });
  }
  return patchEvent(intent, shaped.value, precondition.headers, context, surroundings);
};

export { updateEvent };
export type { UpdateIntent };
