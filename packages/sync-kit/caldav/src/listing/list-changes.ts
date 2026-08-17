import type {
  ChangeListing,
  Fingerprint,
  ListChangesRequest,
  OperationContext,
  Result,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { beginOperation } from "../client/operation";
import { scopeFingerprint } from "../cursor/fingerprint";
import type { FailureSurroundings } from "../errors/to-provider-failure";
import { normalizeCollectionKey } from "../identity/collection-key";
import type { CalDAVInternals } from "../internals";
import { assembleDelta } from "./delta";
import { cursorLostListing } from "./lost";
import { resolveListingMode } from "./mode";
import { assembleSnapshot } from "./snapshot";

const flightKeyOf = (fingerprint: Fingerprint, request: ListChangesRequest): string =>
  `${fingerprint.value}|${request.resume?.value ?? ""}`;

const ownCopyOf = (answered: Result<ChangeListing>): Result<ChangeListing> =>
  structuredClone(answered);

const listCalDAVChanges = (
  internals: CalDAVInternals,
  request: ListChangesRequest,
  context: OperationContext,
): Promise<Result<ChangeListing>> => {
  const { scope } = request;
  const collectionPath = normalizeCollectionKey(
    scope.calendar.calendar.value,
    internals.dependencies.credentials.serverUrl,
  ).value;
  const fingerprint = scopeFingerprint(scope, internals.dependencies.hash);
  const mode = resolveListingMode(request, fingerprint, internals.dependencies.hash);
  const surroundings: FailureSurroundings = {
    account: scope.calendar.account,
    calendar: scope.calendar,
    scope,
    operation: "listChanges",
  };
  const assemble = (leading: AbortSignal): Promise<Result<ChangeListing>> => {
    const run = beginOperation({ ...context, signal: leading }, surroundings);
    switch (mode.kind) {
      case "cursorLost": {
        return Promise.resolve({ ok: true, value: cursorLostListing(scope) });
      }
      case "snapshot":
      case "resumeSnapshot": {
        return assembleSnapshot(internals, { scope, collectionPath, run, fingerprint });
      }
      case "delta": {
        if (!internals.frontier.accepts(collectionPath, mode.state.generation)) {
          return Promise.resolve({ ok: true, value: cursorLostListing(scope) });
        }
        return assembleDelta(internals, {
          scope,
          collectionPath,
          cursor: mode.state,
          resume: null,
          run,
          fingerprint,
        });
      }
      case "resumeDelta": {
        return assembleDelta(internals, {
          scope,
          collectionPath,
          cursor: null,
          resume: mode.state,
          run,
          fingerprint,
        });
      }
      default: {
        return assertNever(mode);
      }
    }
  };
  if (mode.kind === "cursorLost" || internals.reported.corrupted()) {
    return Promise.resolve({ ok: true, value: cursorLostListing(scope) });
  }
  return internals.flights
    .run(flightKeyOf(fingerprint, request), assemble, context.signal)
    .then((answered) => ownCopyOf(answered));
};

export { listCalDAVChanges };
