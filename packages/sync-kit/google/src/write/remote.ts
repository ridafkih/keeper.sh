import type { calendar_v3 } from "@googleapis/calendar";
import type {
  CalendarKey,
  Fingerprint,
  NotAttemptedReason,
  OperationContext,
  ProviderFailure,
  RemoteRef,
  RemoteVersion,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { contentOfPatch, decodeEvent } from "../decode/decode-event";
import { decodeEventTime } from "../decode/event-time";
import { versionOfEtag } from "../decode/identity";
import type { GoogleFailure } from "../errors/classify";
import { toProviderFailure } from "../errors/to-provider-failure";
import { fingerprintContent } from "../fingerprint";
import type { WriteSurroundings } from "./surroundings";

interface RemoteState {
  readonly version: RemoteVersion;
  readonly fingerprint: Fingerprint | null;
}

type FetchedEvent =
  | { readonly kind: "found"; readonly state: RemoteState }
  | { readonly kind: "absent" }
  | { readonly kind: "failed"; readonly failure: GoogleFailure }
  | { readonly kind: "notAttempted"; readonly reason: NotAttemptedReason };

const remoteRefOf = (id: string): RemoteRef => ({
  id: { kind: "remoteEventId", value: id },
  deleteHandle: { kind: "deleteHandle", value: id },
});

const writeFailure = (failure: GoogleFailure, calendar: CalendarKey): ProviderFailure =>
  toProviderFailure(failure, {
    operation: "write",
    calendar,
    account: calendar.account,
    scope: null,
  });

const stateOf = (
  item: calendar_v3.Schema$Event,
  hash: (input: string) => string,
): RemoteState | null => {
  const version = versionOfEtag(item.etag);
  if (version === null) {
    return null;
  }
  const decoded = decodeEvent(item, decodeEventTime);
  if (decoded.kind !== "patch") {
    return { version, fingerprint: null };
  }
  return { version, fingerprint: fingerprintContent(contentOfPatch(decoded.fields), hash) };
};

const fetchEvent = async (
  calendar: CalendarKey,
  eventId: string,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<FetchedEvent> => {
  const answered = await surroundings.requests.send("write", context, (signal) =>
    surroundings.dependencies.calendar.events.get(
      { calendarId: calendar.calendar.value, eventId },
      { signal },
    ),
  );
  switch (answered.kind) {
    case "answered": {
      const state = stateOf(answered.value.data, surroundings.dependencies.hash);
      if (state === null) {
        return { kind: "absent" };
      }
      return { kind: "found", state };
    }
    case "failed": {
      if (answered.failure.kind === "notFound" || answered.failure.kind === "resourceGone") {
        return { kind: "absent" };
      }
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

export { fetchEvent, remoteRefOf, writeFailure };
export type { FetchedEvent, RemoteState };
