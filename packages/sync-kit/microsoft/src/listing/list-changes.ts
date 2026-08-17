import type {
  ChangeListing,
  ListChangesRequest,
  ListingDiagnostics,
  ListingScope,
  OperationContext,
  ProviderFailure,
  RemoteEventId,
  Result,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { ZoneCache } from "@keeper.sh/sync-ical";
import { canonicalise } from "../canonical";
import { raceDeadline } from "../client/deadline";
import type { GraphCall } from "../client/graph-call";
import { graphJson } from "../client/graph-call";
import { preferHeaders } from "../client/prefer";
import type { RequestOutcome, RequestSeam } from "../client/request";
import type { SingleFlight } from "../client/single-flight";
import { mintContinuation, mintCursorIn, parseContinuation, parseCursor } from "../cursor/cursor";
import { readDeltaLink } from "../cursor/delta-link";
import type { ListingMode } from "../cursor/fingerprint";
import { requestShapeFingerprint } from "../cursor/fingerprint";
import type { CursorFrontier } from "../cursor/frontier";
import type { DecodedFields, DecodedItem } from "../decode/decode-event";
import { decodeGraphItem } from "../decode/decode-event";
import { readEventType } from "../decode/event-type";
import type { MicrosoftDependencies } from "../dependencies";
import { toProviderFailure } from "../errors/to-provider-failure";
import type { FailureSurroundings } from "../errors/to-provider-failure";
import { microsoftLimits } from "../limits";
import type { BuiltFeed } from "./build-feed";
import { buildFeed } from "./build-feed";
import type { ArrivedItem } from "./collapse-revisions";
import { collapseRevisions } from "./collapse-revisions";
import { provenCoverage } from "./coverage";
import { listingDiagnostics } from "./diagnostics";
import type { SeriesExpansion } from "./expand-series";
import { expandSeries } from "./expand-series";
import type { GraphPage, PageAnswer, PageWalk } from "./paginate";
import { paginateGraph } from "./paginate";
import { instancesParameters, requestParameters, requestPaths } from "./request-shape";
import { resyncVerdictOf } from "./resync-triggers";

interface ListingSurroundings {
  readonly dependencies: MicrosoftDependencies;
  readonly requests: RequestSeam;
  readonly flights: SingleFlight<Result<ChangeListing>>;
  readonly frontier: CursorFrontier;
  readonly zones: ZoneCache;
}

type Resumption =
  | { readonly kind: "snapshot"; readonly link: string | null }
  | { readonly kind: "delta"; readonly link: string }
  | { readonly kind: "lost" };

type Expansion =
  | { readonly kind: "expanded"; readonly items: readonly unknown[] }
  | { readonly kind: "abandoned" }
  | { readonly kind: "failed"; readonly failure: ProviderFailure };

interface FeedSummary {
  readonly feed: BuiltFeed;
  readonly diagnostics: ListingDiagnostics;
}

const emptyDiagnostics: ListingDiagnostics = {
  withheld: { sample: [], total: 0 },
  selfAuthored: { sample: [], total: 0 },
  unrepresentable: { sample: [], total: 0 },
  pagesFetched: 0,
};

const cursorLostListing = (scope: ListingScope): ChangeListing => ({
  kind: "cursorLost",
  scope,
  diagnostics: emptyDiagnostics,
});

const readProperty = (value: unknown, name: string): unknown => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return Reflect.get(value, name);
};

const textAt = (value: unknown, name: string): string | null => {
  const held = readProperty(value, name);
  if (typeof held !== "string" || held.length === 0) {
    return null;
  }
  return held;
};

const frontierKeyOf = (scope: ListingScope, hash: (input: string) => string): string =>
  requestShapeFingerprint(scope, "delta", hash);

const modeOf = (resumption: Resumption): ListingMode => {
  if (resumption.kind === "delta") {
    return "delta";
  }
  return "snapshot";
};

const startingLink = (resumption: Resumption): string | null => {
  if (resumption.kind === "lost") {
    return null;
  }
  return resumption.link;
};

const resumedFromCursor = (
  request: ListChangesRequest,
  surroundings: ListingSurroundings,
): Resumption => {
  const { resume, scope } = request;
  if (resume === null || resume.kind !== "syncCursor") {
    return { kind: "lost" };
  }
  const { hash } = surroundings.dependencies;
  const reading = parseCursor(resume, scope, { hash });
  if (reading.kind === "unreadable") {
    return { kind: "lost" };
  }
  const { providerLink } = reading.contents;
  if (surroundings.frontier.isSuperseded(frontierKeyOf(scope, hash), providerLink)) {
    return { kind: "lost" };
  }
  return { kind: "delta", link: providerLink };
};

const resumptionOf = (
  request: ListChangesRequest,
  surroundings: ListingSurroundings,
): Resumption => {
  const { resume, scope } = request;
  if (resume === null) {
    return { kind: "snapshot", link: null };
  }
  if (resume.kind === "continuation") {
    const reading = parseContinuation(resume, scope, { hash: surroundings.dependencies.hash });
    if (reading.kind === "unreadable") {
      return { kind: "lost" };
    }
    return { kind: "snapshot", link: reading.contents.providerLink };
  }
  return resumedFromCursor(request, surroundings);
};

const calendarPathOf = (scope: ListingScope): string =>
  `users/${scope.calendar.account.value}/calendars/${scope.calendar.calendar.value}`;

const eventPathOf = (scope: ListingScope, event: RemoteEventId): string =>
  `users/${scope.calendar.account.value}/events/${event.value}`;

const mailboxesOf = (scope: ListingScope): readonly string[] => [scope.calendar.account.value];

const listingFailure = (scope: ListingScope): FailureSurroundings => ({
  operation: "listChanges",
  account: scope.calendar.account,
  calendar: scope.calendar,
  scope,
});

const valuesOf = (body: unknown): readonly unknown[] => {
  const held = readProperty(body, "value");
  if (!Array.isArray(held)) {
    return [];
  }
  return held;
};

const pageOfBody = (body: unknown): GraphPage => {
  const items = valuesOf(body);
  const link = readDeltaLink(body);
  switch (link.kind) {
    case "continue": {
      return { items, nextLink: link.nextLink, deltaLink: null };
    }
    case "advance": {
      return { items, nextLink: null, deltaLink: link.deltaLink };
    }
    case "lost": {
      return { items, nextLink: null, deltaLink: null };
    }
    default: {
      return assertNever(link);
    }
  }
};

const answeredPage = (answered: RequestOutcome<unknown>): PageAnswer => {
  switch (answered.kind) {
    case "answered": {
      return { kind: "page", page: pageOfBody(answered.value) };
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

const pageCallFor = (
  link: string | null,
  scope: ListingScope,
  resumption: Resumption,
): GraphCall => {
  if (link !== null) {
    return { method: "get", path: link, headers: preferHeaders() };
  }
  return {
    method: "get",
    path: `${calendarPathOf(scope)}/${requestPaths.delta}`,
    search: requestParameters(scope, modeOf(resumption)),
    headers: preferHeaders(),
  };
};

const fetchPage = async (
  link: string | null,
  scope: ListingScope,
  resumption: Resumption,
  context: OperationContext,
  surroundings: ListingSurroundings,
): Promise<PageAnswer> => {
  const call = pageCallFor(link ?? startingLink(resumption), scope, resumption);
  const answered = await surroundings.requests.send<unknown>({
    operation: "listChanges",
    mailboxes: mailboxesOf(scope),
    context,
    send: (signal) => graphJson(surroundings.dependencies.graph, call, signal),
  });
  return answeredPage(answered);
};

const fetchInstances = async (
  master: RemoteEventId,
  scope: ListingScope,
  context: OperationContext,
  surroundings: ListingSurroundings,
): Promise<SeriesExpansion> => {
  const answered = await surroundings.requests.send<unknown>({
    operation: "listChanges",
    mailboxes: mailboxesOf(scope),
    context,
    send: (signal) =>
      graphJson(
        surroundings.dependencies.graph,
        {
          method: "get",
          path: `${eventPathOf(scope, master)}/${requestPaths.instances}`,
          search: instancesParameters(scope),
          headers: preferHeaders(),
        },
        signal,
      ),
  });
  switch (answered.kind) {
    case "answered": {
      return { kind: "expanded", instances: valuesOf(answered.value) };
    }
    case "failed": {
      return { kind: "failed", failure: answered.failure };
    }
    case "notAttempted": {
      return {
        kind: "failed",
        failure: { kind: "transport", status: null, disposition: "transient" },
      };
    }
    default: {
      return assertNever(answered);
    }
  }
};

const isSeriesMaster = (item: unknown): boolean => {
  const reading = readEventType(readProperty(item, "type"));
  return reading.kind === "known" && reading.type === "seriesMaster";
};

const masterIdOf = (item: unknown): RemoteEventId | null => {
  const id = textAt(item, "id");
  if (id === null) {
    return null;
  }
  return { kind: "remoteEventId", value: id };
};

const expandItems = async (
  items: readonly unknown[],
  scope: ListingScope,
  context: OperationContext,
  surroundings: ListingSurroundings,
): Promise<Expansion> => {
  const expanded: unknown[] = [];
  for (const item of items) {
    const master = masterIdOf(item);
    if (!isSeriesMaster(item) || master === null) {
      expanded.push(item);
      continue;
    }
    const answered = await expandSeries({
      master,
      context,
      fetchInstances: (named) => fetchInstances(named, scope, context, surroundings),
    });
    switch (answered.kind) {
      case "expanded": {
        expanded.push(...answered.instances);
        break;
      }
      case "empty": {
        break;
      }
      case "abandoned": {
        return { kind: "abandoned" };
      }
      case "failed": {
        return {
          kind: "failed",
          failure: toProviderFailure(answered.failure, listingFailure(scope)),
        };
      }
      default: {
        return assertNever(answered);
      }
    }
  }
  return { kind: "expanded", items: expanded };
};

const expandableItems = (
  items: readonly unknown[],
  scope: ListingScope,
  mode: ListingMode,
  context: OperationContext,
  surroundings: ListingSurroundings,
): Promise<Expansion> => {
  if (!scope.expandRecurrences || mode === "delta") {
    return Promise.resolve({ kind: "expanded", items });
  }
  return expandItems(items, scope, context, surroundings);
};

const fieldsOf = (item: unknown): DecodedFields => ({
  lastModifiedDateTime: textAt(item, "lastModifiedDateTime"),
  createdDateTime: textAt(item, "createdDateTime"),
});

const decodeAll = (
  items: readonly unknown[],
  scope: ListingScope,
  mode: ListingMode,
  surroundings: ListingSurroundings,
): readonly ArrivedItem[] =>
  items.map((item, arrival) => ({
    item: decodeGraphItem(item, {
      calendar: scope.calendar,
      installation: surroundings.dependencies.installation,
      zones: surroundings.zones,
      hash: surroundings.dependencies.hash,
      mode,
    }),
    arrival,
    fields: fieldsOf(item),
  }));

const decodedItemsOf = (arrived: readonly ArrivedItem[]): readonly DecodedItem[] =>
  arrived.map((entry) => entry.item);

const summarisedFeed = (
  kept: readonly DecodedItem[],
  discarded: number,
  scope: ListingScope,
  pagesFetched: number,
  surroundings: ListingSurroundings,
): FeedSummary => {
  const feed = buildFeed({ items: kept, scope, installation: surroundings.dependencies.installation });
  return {
    feed,
    diagnostics: listingDiagnostics({
      withheld: feed.withheld,
      selfAuthored: feed.selfAuthored,
      discarded: discarded + feed.discarded,
      pagesFetched,
    }),
  };
};

const completedListing = async (
  walk: Extract<PageWalk, { kind: "complete" }>,
  scope: ListingScope,
  resumption: Resumption,
  context: OperationContext,
  surroundings: ListingSurroundings,
): Promise<Result<ChangeListing>> => {
  const mode = modeOf(resumption);
  const expansion = await expandableItems(walk.items, scope, mode, context, surroundings);
  if (expansion.kind === "failed") {
    return { ok: false, failure: expansion.failure };
  }
  if (expansion.kind === "abandoned") {
    return { ok: false, failure: { kind: "notAttempted", reason: "aborted" } };
  }
  const arrived = decodeAll(expansion.items, scope, mode, surroundings);
  const verdict = resyncVerdictOf(decodedItemsOf(arrived), mode);
  if (verdict.kind === "resyncRequired") {
    return { ok: true, value: cursorLostListing(scope) };
  }
  const collapsed = collapseRevisions(arrived);
  const summary = summarisedFeed(collapsed.kept, collapsed.discarded, scope, walk.pagesFetched, surroundings);
  const { hash } = surroundings.dependencies;
  const { window: walked } = scope;
  const cursor = mintCursorIn(scope, mode, walk.deltaLink, { hash });
  surroundings.frontier.advance(frontierKeyOf(scope, hash), walk.deltaLink);
  const shared = {
    scope,
    coverage: provenCoverage(scope, walked),
    events: summary.feed.events,
    removals: summary.feed.removals,
    withheld: summary.feed.withheld,
    cursor,
    diagnostics: summary.diagnostics,
  };
  if (mode === "delta") {
    return { ok: true, value: { kind: "delta", ...shared } };
  }
  return { ok: true, value: { kind: "snapshot", ...shared } };
};

const truncatedListing = (
  walk: Extract<PageWalk, { kind: "truncated" }>,
  scope: ListingScope,
  resumption: Resumption,
  surroundings: ListingSurroundings,
): Result<ChangeListing> => {
  const arrived = decodeAll(walk.items, scope, modeOf(resumption), surroundings);
  const collapsed = collapseRevisions(arrived);
  const summary = summarisedFeed(collapsed.kept, collapsed.discarded, scope, walk.pagesFetched, surroundings);
  return {
    ok: true,
    value: {
      kind: "partial",
      scope,
      events: summary.feed.events,
      withheld: summary.feed.withheld,
      continuation: mintContinuation(scope, walk.nextLink, {
        hash: surroundings.dependencies.hash,
      }),
      diagnostics: summary.diagnostics,
    },
  };
};

const answeredWalk = (
  walk: PageWalk,
  scope: ListingScope,
  resumption: Resumption,
  context: OperationContext,
  surroundings: ListingSurroundings,
): Promise<Result<ChangeListing>> => {
  switch (walk.kind) {
    case "cursorLost": {
      return Promise.resolve({ ok: true, value: cursorLostListing(scope) });
    }
    case "notAttempted": {
      return Promise.resolve({ ok: false, failure: { kind: "notAttempted", reason: walk.reason } });
    }
    case "failed": {
      return Promise.resolve({
        ok: false,
        failure: toProviderFailure(walk.failure, listingFailure(scope)),
      });
    }
    case "truncated": {
      return Promise.resolve(truncatedListing(walk, scope, resumption, surroundings));
    }
    case "complete": {
      return completedListing(walk, scope, resumption, context, surroundings);
    }
    default: {
      return Promise.resolve(assertNever(walk));
    }
  }
};

const leadListing = async (
  scope: ListingScope,
  resumption: Resumption,
  context: OperationContext,
  surroundings: ListingSurroundings,
): Promise<Result<ChangeListing>> => {
  const walk = await paginateGraph({
    context,
    clock: surroundings.dependencies.clock,
    maxPages: microsoftLimits.maxPages,
    fetchPage: (link) => fetchPage(link, scope, resumption, context, surroundings),
  });
  return answeredWalk(walk, scope, resumption, context, surroundings);
};

const flightKeyOf = (request: ListChangesRequest, surroundings: ListingSurroundings): string =>
  canonicalise({
    shape: frontierKeyOf(request.scope, surroundings.dependencies.hash),
    resume: request.resume?.value ?? "",
  });

const listMicrosoftChanges = async (
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

export { cursorLostListing, listMicrosoftChanges };
export type { ListingSurroundings };
