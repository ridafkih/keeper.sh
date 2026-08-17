import type {
  ChangeListing,
  ListChangesRequest,
  ListingScope,
  OperationContext,
  Result,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { canonicalise } from "../canonical";
import { raceDeadline } from "../client/deadline";
import type { RequestSeam } from "../client/request";
import type { SingleFlight } from "../client/single-flight";
import { mintContinuation, mintCursor, parseContinuation, parseCursor } from "../cursor/cursor";
import { requestShapeFingerprint } from "../cursor/fingerprint";
import type { GoogleDependencies } from "../dependencies";
import { toProviderFailure } from "../errors/to-provider-failure";
import { googleListingLimits } from "../limits";
import type { MintedEventIds } from "../write/minted-ids";
import { resolveFeed } from "./build-feed";
import { provenCoverage } from "./coverage";
import { listingDiagnostics } from "./diagnostics";
import type { PageAnswer, PageWalk } from "./paginate";
import { paginateEvents } from "./paginate";
import { deltaParameters, snapshotParameters } from "./request-shape";

interface CursorFrontier {
  readonly latest: (fingerprint: string) => string | null;
  readonly advance: (fingerprint: string, value: string) => void;
}

interface ListingSurroundings {
  readonly dependencies: GoogleDependencies;
  readonly requests: RequestSeam;
  readonly flights: SingleFlight<Result<ChangeListing>>;
  readonly frontier: CursorFrontier;
  readonly mintedIds: MintedEventIds;
}

type Resumption =
  | { readonly kind: "snapshot"; readonly pageToken: string | null }
  | { readonly kind: "delta"; readonly syncToken: string }
  | { readonly kind: "lost" };

const emptyDiagnostics = {
  withheld: { sample: [], total: 0 },
  selfAuthored: { sample: [], total: 0 },
  unrepresentable: { sample: [], total: 0 },
  pagesFetched: 0,
} as const;

const cursorLostListing = (scope: ListingScope): ChangeListing => ({
  kind: "cursorLost",
  scope,
  diagnostics: emptyDiagnostics,
});

const deltaFingerprintOf = (scope: ListingScope, hash: (input: string) => string): string =>
  requestShapeFingerprint(scope, "delta", hash);

const resumedFromCursor = (
  request: ListChangesRequest,
  surroundings: ListingSurroundings,
): Resumption => {
  const { resume, scope } = request;
  if (resume === null || resume.kind !== "syncCursor") {
    return { kind: "lost" };
  }
  const { hash } = surroundings.dependencies;
  const held = surroundings.frontier.latest(deltaFingerprintOf(scope, hash));
  if (held !== null && held !== resume.value) {
    return { kind: "lost" };
  }
  const reading = parseCursor(resume, scope, { hash });
  if (reading.kind === "unreadable") {
    return { kind: "lost" };
  }
  return { kind: "delta", syncToken: reading.contents.providerToken };
};

const resumptionOf = (
  request: ListChangesRequest,
  surroundings: ListingSurroundings,
): Resumption => {
  const { resume, scope } = request;
  if (resume === null) {
    return { kind: "snapshot", pageToken: null };
  }
  if (resume.kind === "continuation") {
    const reading = parseContinuation(resume, scope, {
      hash: surroundings.dependencies.hash,
    });
    if (reading.kind === "unreadable") {
      return { kind: "lost" };
    }
    return { kind: "snapshot", pageToken: reading.contents.providerToken };
  }
  return resumedFromCursor(request, surroundings);
};

const parametersFor = (
  scope: ListingScope,
  resumption: Resumption,
  pageToken: string | null,
): ReturnType<typeof snapshotParameters> => {
  if (resumption.kind === "delta") {
    return deltaParameters(scope, resumption.syncToken, pageToken);
  }
  return snapshotParameters(scope, pageToken);
};

const fetchEventsPage = async (
  scope: ListingScope,
  resumption: Resumption,
  pageToken: string | null,
  context: OperationContext,
  surroundings: ListingSurroundings,
): Promise<PageAnswer> => {
  const answered = await surroundings.requests.send("listChanges", context, (signal) =>
    surroundings.dependencies.calendar.events.list(
      parametersFor(scope, resumption, pageToken),
      { signal },
    ),
  );
  switch (answered.kind) {
    case "answered": {
      return { kind: "page", page: answered.value.data };
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

const startingToken = (resumption: Resumption): string | null => {
  if (resumption.kind === "snapshot") {
    return resumption.pageToken;
  }
  return null;
};

const completedListing = (
  walk: Extract<PageWalk, { kind: "complete" }>,
  scope: ListingScope,
  resumption: Resumption,
  surroundings: ListingSurroundings,
): ChangeListing => {
  const { hash, installation } = surroundings.dependencies;
  const feed = resolveFeed({
    items: walk.items,
    scope,
    installation,
    hash,
    mintedIds: surroundings.mintedIds.known(),
  });
  const diagnostics = listingDiagnostics({
    withheld: feed.withheld,
    unnamedDiscards: feed.unnamedDiscards,
    selfAuthored: feed.selfAuthored,
    pagesFetched: walk.pagesFetched,
  });
  const cursor = mintCursor(scope, walk.syncToken, { hash });
  surroundings.frontier.advance(deltaFingerprintOf(scope, hash), cursor.value);
  /*
   * A walk that began at a continuation enumerated only the pages after the resume point.
   * The pages handed back earlier are not in this listing, so claiming the requested window
   * would make every one of them an absence, and absence on a snapshot is a deletion. This
   * listing proves nothing about the window, so it carries no coverage and stays partial —
   * a calendar too large to walk before the deadline yields no deletion authority, which is
   * the safe half of that trade.
   */
  if (resumption.kind === "snapshot" && resumption.pageToken !== null) {
    return {
      kind: "partial",
      scope,
      events: feed.events,
      withheld: feed.withheld,
      continuation: mintContinuation(scope, walk.syncToken, { hash }),
      diagnostics,
    };
  }
  const { window: bounds } = scope;
  const shared = {
    scope,
    coverage: provenCoverage(bounds, scope.calendar),
    events: feed.events,
    removals: feed.removals,
    withheld: feed.withheld,
    cursor,
    diagnostics,
  };
  if (resumption.kind === "delta") {
    return { kind: "delta", ...shared };
  }
  return { kind: "snapshot", ...shared };
};

const truncatedListing = (
  walk: Extract<PageWalk, { kind: "truncated" }>,
  scope: ListingScope,
  surroundings: ListingSurroundings,
): ChangeListing => {
  const { hash, installation } = surroundings.dependencies;
  const feed = resolveFeed({
    items: walk.items,
    scope,
    installation,
    hash,
    mintedIds: surroundings.mintedIds.known(),
  });
  return {
    kind: "partial",
    scope,
    events: feed.events,
    withheld: feed.withheld,
    continuation: mintContinuation(scope, walk.pageToken, { hash }),
    diagnostics: listingDiagnostics({
      withheld: feed.withheld,
      unnamedDiscards: feed.unnamedDiscards,
      selfAuthored: feed.selfAuthored,
      pagesFetched: walk.pagesFetched,
    }),
  };
};

const answeredWalk = (
  walk: PageWalk,
  scope: ListingScope,
  resumption: Resumption,
  surroundings: ListingSurroundings,
): Result<ChangeListing> => {
  switch (walk.kind) {
    case "cursorLost": {
      return { ok: true, value: cursorLostListing(scope) };
    }
    case "notAttempted": {
      return { ok: false, failure: { kind: "notAttempted", reason: walk.reason } };
    }
    case "failed": {
      return {
        ok: false,
        failure: toProviderFailure(walk.failure, {
          operation: "listChanges",
          calendar: scope.calendar,
          account: scope.calendar.account,
          scope,
        }),
      };
    }
    case "truncated": {
      return { ok: true, value: truncatedListing(walk, scope, surroundings) };
    }
    case "complete": {
      return { ok: true, value: completedListing(walk, scope, resumption, surroundings) };
    }
    default: {
      return assertNever(walk);
    }
  }
};

const leadListing = async (
  scope: ListingScope,
  resumption: Resumption,
  context: OperationContext,
  surroundings: ListingSurroundings,
): Promise<Result<ChangeListing>> => {
  const walk = await paginateEvents({
    context,
    clock: surroundings.dependencies.clock,
    maxPages: googleListingLimits.maxPages,
    fetchPage: (pageToken) =>
      fetchEventsPage(
        scope,
        resumption,
        pageToken ?? startingToken(resumption),
        context,
        surroundings,
      ),
  });
  return answeredWalk(walk, scope, resumption, surroundings);
};

const flightKeyOf = (
  request: ListChangesRequest,
  surroundings: ListingSurroundings,
): string =>
  canonicalise({
    shape: deltaFingerprintOf(request.scope, surroundings.dependencies.hash),
    resume: request.resume?.value ?? "",
  });

const listGoogleChanges = async (
  request: ListChangesRequest,
  context: OperationContext,
  surroundings: ListingSurroundings,
): Promise<Result<ChangeListing>> => {
  const { scope } = request;
  const resumption = resumptionOf(request, surroundings);
  if (resumption.kind === "lost") {
    return { ok: true, value: cursorLostListing(scope) };
  }
  const key = flightKeyOf(request, surroundings);
  const raced = await raceDeadline(context, surroundings.dependencies.clock, (joiner) =>
    surroundings.flights.run(
      key,
      (shared) => leadListing(scope, resumption, { ...context, signal: shared }, surroundings),
      joiner,
    ),
  );
  if (raced.kind === "notAttempted") {
    return { ok: false, failure: { kind: "notAttempted", reason: raced.reason } };
  }
  return structuredClone(raced.value);
};

export { listGoogleChanges };
export type { CursorFrontier, ListingSurroundings };
