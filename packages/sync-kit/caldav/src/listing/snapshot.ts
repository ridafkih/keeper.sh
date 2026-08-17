import type {
  ChangeListing,
  Fingerprint,
  ListingScope,
  Result,
  SyncCursor,
} from "@keeper.sh/sync-protocol";
import { caldavIcsOptions } from "../canonical";
import type { CalDAVOperation } from "../client/operation";
import { mintContinuation } from "../cursor/continuation";
import { mintCursor } from "../cursor/cursor";
import type { CalDAVInternals } from "../internals";
import { caldavLimits } from "../limits";
import { readCollectionState } from "../report/collection-tag";
import { probeSupportedReports } from "../report/supported-reports";
import { buildCalDAVFeed } from "./build-feed";
import type { CalDAVFeed } from "./build-feed";
import { coverageOver, provenCoverage } from "./coverage";
import { caldavDiagnostics } from "./diagnostics";
import { enumerateCollection } from "./enumerate";
import { multigetResources } from "./multiget";
import { removalsAgainstReported } from "./reported";

interface SnapshotRequest {
  readonly scope: ListingScope;
  readonly collectionPath: string;
  readonly run: CalDAVOperation;
  readonly fingerprint: Fingerprint;
}

interface ReadResources {
  readonly feed: CalDAVFeed;
  readonly listedCount: number;
  readonly requestedCount: number;
  readonly pages: number;
  readonly complete: boolean;
}

const emptyFeed: CalDAVFeed = {
  events: [],
  removals: [],
  withheld: [],
  selfAuthored: [],
  readCount: 0,
  unreadableCount: 0,
};

const feedOf = (
  internals: CalDAVInternals,
  request: SnapshotRequest,
  resources: Parameters<typeof buildCalDAVFeed>[0]["resources"],
): Result<CalDAVFeed> =>
  buildCalDAVFeed({
    resources,
    scope: request.scope,
    options: caldavIcsOptions(internals.dependencies),
    hash: internals.dependencies.hash,
  });

const readByEnumerating = async (
  internals: CalDAVInternals,
  request: SnapshotRequest,
): Promise<Result<ReadResources>> => {
  const enumerated = await enumerateCollection(internals, request.collectionPath, request.run);
  if (!enumerated.ok) {
    return { ok: false, failure: enumerated.failure };
  }
  const paths = enumerated.value.listed.map((entry) => entry.path);
  const read = await multigetResources(internals, request.collectionPath, paths, request.run);
  if (!read.ok) {
    return { ok: false, failure: read.failure };
  }
  internals.decisions.recordCoverage({
    collectionPath: request.collectionPath,
    resourcePaths: read.value.resources.map((resource) => resource.path),
  });
  const built = feedOf(internals, request, read.value.resources);
  if (!built.ok) {
    return { ok: false, failure: built.failure };
  }
  return {
    ok: true,
    value: {
      feed: built.value,
      listedCount: paths.length,
      requestedCount: paths.length,
      pages: Math.max(1, read.value.batches),
      complete: !enumerated.value.truncated && read.value.kind === "complete",
    },
  };
};

const partialListing = (
  request: SnapshotRequest,
  read: ReadResources,
): ChangeListing => ({
  kind: "partial",
  scope: request.scope,
  events: read.feed.events,
  withheld: read.feed.withheld,
  continuation: mintContinuation(
    {
      version: 1,
      mode: "resumeSnapshot",
      token: "",
      cursorToken: null,
      scopeFingerprint: request.fingerprint,
    },
    request.scope,
  ),
  diagnostics: caldavDiagnostics(read.feed, read.pages, caldavLimits.diagnosticSampleSize),
});

const admitsAnything = (scope: ListingScope): boolean =>
  Date.parse(scope.window.end.value) > Date.parse(scope.window.start.value);

const emptySnapshot = (request: SnapshotRequest): ChangeListing => ({
  kind: "snapshot",
  scope: request.scope,
  coverage: coverageOver(request.scope),
  events: [],
  removals: [],
  withheld: [],
  cursor: null,
  diagnostics: caldavDiagnostics(emptyFeed, 0, caldavLimits.diagnosticSampleSize),
});

const mintedCursor = (
  internals: CalDAVInternals,
  request: SnapshotRequest,
  token: string | null,
): SyncCursor | null => {
  if (token === null || token.length === 0) {
    return null;
  }
  return mintCursor(
    {
      version: 1,
      token,
      scopeFingerprint: request.fingerprint,
      generation: internals.frontier.advance(request.collectionPath),
    },
    request.scope,
    internals.dependencies.hash,
  );
};

const tokenBeforeReading = async (
  internals: CalDAVInternals,
  request: SnapshotRequest,
  syncCollection: boolean,
): Promise<Result<string | null>> => {
  if (!syncCollection) {
    return { ok: true, value: null };
  }
  const state = await readCollectionState(internals, request.collectionPath, request.run);
  if (!state.ok) {
    return { ok: false, failure: state.failure };
  }
  return { ok: true, value: state.value.syncToken };
};

const assembleSnapshot = async (
  internals: CalDAVInternals,
  request: SnapshotRequest,
): Promise<Result<ChangeListing>> => {
  if (!admitsAnything(request.scope)) {
    return { ok: true, value: emptySnapshot(request) };
  }
  const probed = await probeSupportedReports(internals, request.collectionPath, request.run);
  if (!probed.ok) {
    return { ok: false, failure: probed.failure };
  }
  const token = await tokenBeforeReading(internals, request, probed.value.syncCollection);
  if (!token.ok) {
    return { ok: false, failure: token.failure };
  }
  const read = await readByEnumerating(internals, request);
  if (!read.ok) {
    return { ok: false, failure: read.failure };
  }
  const { feed } = read.value;
  const coverage = provenCoverage(request.scope, {
    listedCount: read.value.listedCount,
    requestedCount: read.value.requestedCount,
    readCount: feed.readCount,
  });
  if (!read.value.complete || coverage === null) {
    return { ok: true, value: partialListing(request, read.value) };
  }
  return {
    ok: true,
    value: {
      kind: "snapshot",
      scope: request.scope,
      coverage,
      events: feed.events,
      removals: [
        ...feed.removals,
        ...removalsAgainstReported(internals.reported, request.collectionPath, feed),
      ],
      withheld: feed.withheld,
      cursor: mintedCursor(internals, request, token.value),
      diagnostics: caldavDiagnostics(feed, read.value.pages, caldavLimits.diagnosticSampleSize),
    },
  };
};

export { assembleSnapshot };
export type { SnapshotRequest };
