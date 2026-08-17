import type {
  ChangeListing,
  Fingerprint,
  ListingScope,
  RemoteEventId,
  Removal,
  Result,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { caldavIcsOptions } from "../canonical";
import type { CalDAVOperation } from "../client/operation";
import type { ContinuationState } from "../cursor/continuation";
import { mintContinuation } from "../cursor/continuation";
import type { CursorState } from "../cursor/cursor";
import { mintCursor } from "../cursor/cursor";
import type { CalDAVInternals } from "../internals";
import { caldavLimits } from "../limits";
import { buildCalDAVFeed } from "./build-feed";
import type { CalDAVFeed } from "./build-feed";
import { coverageOver } from "./coverage";
import { caldavDiagnostics } from "./diagnostics";
import { cursorLostListing } from "./lost";
import type { ReportedLedger } from "./reported";
import { walkSyncCollection } from "./sync-walk";

interface DeltaRequest {
  readonly scope: ListingScope;
  readonly collectionPath: string;
  readonly cursor: CursorState | null;
  readonly resume: ContinuationState | null;
  readonly run: CalDAVOperation;
  readonly fingerprint: Fingerprint;
}

const tokenOf = (request: DeltaRequest): string | null => {
  if (request.resume) {
    return request.resume.token;
  }
  return request.cursor?.token ?? null;
};

const carriedCursorToken = (request: DeltaRequest): string | null => {
  if (request.resume) {
    return request.resume.cursorToken;
  }
  return request.cursor?.token ?? null;
};

const feedOf = (
  internals: CalDAVInternals,
  request: DeltaRequest,
  resources: Parameters<typeof buildCalDAVFeed>[0]["resources"],
): Result<CalDAVFeed> =>
  buildCalDAVFeed({
    resources,
    scope: request.scope,
    options: caldavIcsOptions(internals.dependencies),
    hash: internals.dependencies.hash,
  });

const withinCollection = (path: string, collectionPath: string): boolean =>
  path.startsWith(collectionPath) && path !== collectionPath;

const tombstoneRemoval = (
  reported: ReportedLedger,
  collectionPath: string,
  path: string,
): readonly Removal[] => {
  if (!withinCollection(path, collectionPath)) {
    return [];
  }
  const id: RemoteEventId = { kind: "remoteEventId", value: path };
  const uid = reported.uidAt(collectionPath, path);
  if (uid === null) {
    return [{ kind: "outOfScope", id }];
  }
  return [{ kind: "deleted", id, uid: { kind: "eventUid", value: uid } }];
};

const tombstoneRemovals = (
  reported: ReportedLedger,
  collectionPath: string,
  removed: readonly string[],
): readonly Removal[] =>
  removed.flatMap((path) => tombstoneRemoval(reported, collectionPath, path));

const assembleDelta = async (
  internals: CalDAVInternals,
  request: DeltaRequest,
): Promise<Result<ChangeListing>> => {
  const walked = await walkSyncCollection(internals, {
    collectionPath: request.collectionPath,
    token: tokenOf(request),
    pageCeiling: caldavLimits.syncPageCeiling,
    run: request.run,
  });
  if (!walked.ok) {
    return { ok: false, failure: walked.failure };
  }
  const walk = walked.value;
  switch (walk.kind) {
    case "tokenRejected": {
      return { ok: true, value: cursorLostListing(request.scope) };
    }
    case "truncated": {
      if (walk.removed.length > 0) {
        return { ok: true, value: cursorLostListing(request.scope) };
      }
      const built = feedOf(internals, request, walk.resources);
      if (!built.ok) {
        return { ok: false, failure: built.failure };
      }
      return {
        ok: true,
        value: {
          kind: "partial",
          scope: request.scope,
          events: built.value.events,
          withheld: built.value.withheld,
          continuation: mintContinuation(
            {
              version: 1,
              mode: "resumeDelta",
              token: walk.resumeToken,
              cursorToken: carriedCursorToken(request),
              scopeFingerprint: request.fingerprint,
            },
            request.scope,
          ),
          diagnostics: caldavDiagnostics(
            built.value,
            walk.pages,
            caldavLimits.diagnosticSampleSize,
          ),
        },
      };
    }
    case "complete": {
      const built = feedOf(internals, request, walk.resources);
      if (!built.ok) {
        return { ok: false, failure: built.failure };
      }
      const removals = [
        ...built.value.removals,
        ...tombstoneRemovals(internals.reported, request.collectionPath, walk.removed),
      ];
      internals.reported.merge(request.collectionPath, built.value, walk.removed);
      return {
        ok: true,
        value: {
          kind: "delta",
          scope: request.scope,
          coverage: coverageOver(request.scope),
          events: built.value.events,
          removals,
          withheld: built.value.withheld,
          cursor: mintCursor(
            {
              version: 1,
              token: walk.token,
              scopeFingerprint: request.fingerprint,
              generation: internals.frontier.advance(request.collectionPath),
            },
            request.scope,
            internals.dependencies.hash,
          ),
          diagnostics: caldavDiagnostics(
            built.value,
            walk.pages,
            caldavLimits.diagnosticSampleSize,
          ),
        },
      };
    }
    default: {
      return assertNever(walk);
    }
  }
};

export { assembleDelta };
export type { DeltaRequest };
