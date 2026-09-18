import type {
  AccountId,
  CalendarEnumeration,
  ChangeListing,
  Continuation,
  CoverageWindow,
  EchoVerdict,
  EditableContent,
  EventUid,
  Instant,
  ListChangesRequest,
  ListingDiagnostics,
  ListingScope,
  NormalizedContent,
  OperationContext,
  ProviderFailure,
  RemoteEvent,
  RemoteRef,
  Removal,
  Result,
  SyncCursor,
  WithheldEvent,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import type { ThrottleSignal } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { ConformanceCaseId } from "../case-id";
import type { KeyOrder } from "../canonical";
import { canonicalise, insertionOrderKeys, sortedKeys } from "../canonical";
import type { DeadlineAnswers } from "../deadline";
import { raceDeadline, standardAnswers } from "../deadline";
import { conformanceLimits } from "../limits";
import type { ConformanceEnvironment, ProviderSeed, ProviderUnderTest } from "../options";
import { createSingleFlight } from "../single-flight";
import { failureOfTransportError, TransportStatus } from "../transport";
import { referenceCalendar } from "./calendar";
import { referenceCapabilities } from "./capabilities";
import { createCursorMint, scopeKeyOf } from "./cursor";
import type { Defect } from "./defect";
import { defectIs, isMarked } from "./defect";
import { encodeIdentity, fingerprintWith, referenceFingerprintContract } from "./fingerprint";
import type { ResolvedFeed } from "./listing";
import {
  admitsAnything,
  coverageOver,
  cursorLostListing,
  diagnosticsOf,
  emptySnapshot,
  identitiesOf,
  removalsAgainst,
  resolveFeed,
} from "./listing";
import { constraintViolatedBy, rewriteAsProviderWould } from "./normalize";
import type { ReportedIdentity } from "./store";
import { createReferenceStore } from "./store";

interface ReferenceOptions {
  readonly environment: ConformanceEnvironment;
  readonly defect: Defect;
}

interface DecidedWrite {
  readonly outcome: Result<WriteOutcome>;
  readonly commit: () => void;
}

const remoteRefFor = (uid: string): RemoteRef => ({
  id: { kind: "remoteEventId", value: `id-${uid}` },
  deleteHandle: { kind: "deleteHandle", value: `handle-${uid}` },
});

const versionFor = (uid: string, revision: number): string => `v${revision}-${uid}`;

const dayMs = 24 * 60 * 60 * 1000;

const isRetryable = (failure: ProviderFailure): boolean => failure.kind === "rateLimited";

const retryDelayFor = (failure: ProviderFailure, context: OperationContext): number => {
  const ceiling = context.retryBudget.retryDelayCeilingMs;
  if (failure.kind !== "rateLimited" || failure.retryAfter === null) {
    return ceiling;
  }
  const asked = Date.parse(failure.retryAfter.value) - Date.parse(context.now().value);
  return Math.max(0, Math.min(ceiling, asked));
};

const aborted: ProviderFailure = { kind: "notAttempted", reason: "aborted" };
const exhausted: ProviderFailure = { kind: "notAttempted", reason: "budgetExhausted" };

const withheldExcept = (
  withheld: readonly WithheldEvent[],
  excluded: (entry: WithheldEvent) => boolean,
): readonly WithheldEvent[] => withheld.filter((entry) => !excluded(entry));

const midnightOf = (date: string): Instant => ({ kind: "instant", value: `${date}T00:00:00.000Z` });

const asMidnightPair = (event: RemoteEvent): RemoteEvent => {
  const { content } = event;
  if (content.recurrence !== null || content.time.kind !== "allDay") {
    return event;
  }
  return {
    ...event,
    content: {
      ...content,
      time: {
        kind: "timed",
        start: midnightOf(content.time.startDate.value),
        end: midnightOf(content.time.endDateExclusive.value),
        zone: { kind: "zoneId", value: "UTC" },
      },
    },
  };
};

const plainlyDeleted = (removal: Removal): Removal => {
  if (removal.kind !== "cancelled") {
    return removal;
  }
  return { kind: "deleted", id: removal.id, uid: removal.uid };
};

const truncatedAsPartial = (
  scope: ListingScope,
  feed: ResolvedFeed,
  diagnostics: ListingDiagnostics,
): ChangeListing => ({
  kind: "partial",
  scope,
  events: feed.events,
  withheld: feed.withheld,
  continuation: { kind: "continuation", value: "defective", scope },
  diagnostics,
});

const RESUMED_TAIL_FROM = 1;

const noop = (): null => null;

const holds = (held: boolean, complaint: string): Promise<void> => {
  if (!held) {
    throw new Error(complaint);
  }
  return Promise.resolve();
};

const answeredWith = <Value>(value: Value): Promise<Value> => Promise.resolve(value);

const staleConflict = (existing: RemoteEvent): Result<WriteOutcome> => ({
  ok: false,
  failure: {
    kind: "conflict",
    observed: { kind: "matchesVersion", version: existing.version },
  },
});

interface ReferenceCounters {
  deltaFloor: number;
  carriedPages: number;
  leakedPermits: number;
  callersInFlight: number;
  abortsInBurst: number;
  attemptsSpent: number;
  attemptsAllowed: number;
}

const attemptsUpTo = (ceiling: number): readonly number[] =>
  Array.from({ length: Math.max(0, ceiling) }, (unused, index) => index + 1);

const createReference = (options: ReferenceOptions): ProviderUnderTest<"reference"> => {
  const { environment, defect } = options;
  const store = createReferenceStore(referenceCalendar);
  const mint = createCursorMint(environment.hash);
  const lifetime = new AbortController();
  const poisoned = new Set<string>();
  const counters: ReferenceCounters = {
    deltaFloor: 0,
    carriedPages: 0,
    leakedPermits: 0,
    callersInFlight: 0,
    abortsInBurst: 0,
    attemptsSpent: 0,
    attemptsAllowed: 0,
  };

  const observedAt = (): Instant => {
    if (defectIs(defect, "CONF-L13")) {
      return { kind: "instant", value: "1970-01-01T00:00:00.000Z" };
    }
    return environment.clock.now();
  };

  const indeterminate = (event: RemoteEvent): RemoteEvent => {
    if (!isMarked(event.uid.value, "CONF-O16")) {
      return event;
    }
    return {
      id: event.id,
      deleteHandle: event.deleteHandle,
      uid: event.uid,
      calendar: event.calendar,
      revision: event.revision,
      version: event.version,
      content: event.content,
      fingerprint: event.fingerprint,
      provenance: { kind: "indeterminate" },
    };
  };

  const phantom = (): RemoteEvent => ({
    ...remoteRefFor("CONF-O3:ghost"),
    uid: { kind: "eventUid", value: "CONF-O3:ghost" },
    calendar: referenceCalendar,
    revision: 1,
    version: { kind: "remoteVersion", value: "v1-phantom" },
    content: {
      title: "Phantom",
      description: null,
      location: null,
      availability: "busy",
      visibility: "default",
      recurrence: null,
      time: {
        kind: "timed",
        start: { kind: "instant", value: "2026-03-15T09:00:00.000Z" },
        end: { kind: "instant", value: "2026-03-15T10:00:00.000Z" },
        zone: null,
      },
    },
    fingerprint: { kind: "fingerprint", value: "phantom" },
    provenance: { kind: "foreign" },
  });

  const isCancelled = (event: RemoteEvent): boolean =>
    store.cancelled().some((uid) => uid.value === event.uid.value);

  const liveObjects = (): readonly RemoteEvent[] =>
    store.objects().filter((event) => !isCancelled(event));

  const markedIn = (id: ConformanceCaseId): readonly RemoteEvent[] =>
    liveObjects().filter((event) => isMarked(event.uid.value, id));

  const unmarkedFeed = (id: ConformanceCaseId): ResolvedFeed =>
    resolveFeed(liveObjects().filter((event) => !isMarked(event.uid.value, id)));

  const flights = createSingleFlight<Result<ChangeListing>>({
    retain: (settled) =>
      defectIs(defect, "CONF-L7") &&
      markedIn("CONF-L7").length > 0 &&
      !settled.ok &&
      settled.failure.kind === "transport" &&
      settled.failure.status === null,
  });

  const resolvedFeed = (): ResolvedFeed => {
    if (defectIs(defect, "CONF-O22")) {
      const resolved = resolveFeed(liveObjects());
      return {
        events: [...resolved.events, ...markedIn("CONF-O22")],
        withheld: resolved.withheld,
      };
    }
    if (defectIs(defect, "CONF-O8")) {
      const rest = unmarkedFeed("CONF-O8");
      const last = markedIn("CONF-O8").at(-1);
      if (!last) {
        return rest;
      }
      return { events: [...rest.events, last], withheld: rest.withheld };
    }
    if (defectIs(defect, "CONF-O7")) {
      const rest = unmarkedFeed("CONF-O7");
      const oldest = markedIn("CONF-O7").filter((event) => event.revision === 1);
      return { events: [...rest.events, ...oldest], withheld: rest.withheld };
    }
    return resolveFeed(liveObjects());
  };

  const defectiveFeed = (feed: ResolvedFeed): ResolvedFeed => {
    if (defectIs(defect, "CONF-O1")) {
      const marked = feed.events.filter((event) => isMarked(event.uid.value, "CONF-O1"));
      const kept = feed.events.filter((event) => !isMarked(event.uid.value, "CONF-O1"));
      return { events: [...kept, ...marked.slice(0, 1)], withheld: feed.withheld };
    }
    if (defectIs(defect, "CONF-O3") && markedIn("CONF-O3").length > 0) {
      return { events: [...feed.events, phantom()], withheld: feed.withheld };
    }
    if (defectIs(defect, "CONF-O5")) {
      return {
        events: feed.events,
        withheld: withheldExcept(feed.withheld, (entry) =>
          isMarked(entry.uid?.value ?? "", "CONF-O5"),
        ),
      };
    }
    if (defectIs(defect, "CONF-O16")) {
      return { events: feed.events.map(indeterminate), withheld: feed.withheld };
    }
    if (defectIs(defect, "CONF-O26")) {
      return {
        events: feed.events.filter((event) => !isMarked(event.uid.value, "CONF-O26")),
        withheld: feed.withheld,
      };
    }
    if (defectIs(defect, "CONF-O27")) {
      return {
        events: feed.events.filter((event) => !event.uid.value.endsWith(":onLowerEdge")),
        withheld: feed.withheld,
      };
    }
    if (defectIs(defect, "CONF-O28")) {
      const degenerate = feed.events.filter((event) => isMarked(event.uid.value, "CONF-O28"));
      return {
        events: feed.events.filter((event) => !isMarked(event.uid.value, "CONF-O28")),
        withheld: [
          ...feed.withheld,
          ...degenerate.map((event) => ({
            uid: event.uid,
            id: event.id,
            reason: "unrepresentableTime" as const,
          })),
        ],
      };
    }
    if (defectIs(defect, "CONF-O45")) {
      return { events: feed.events.map((event) => asMidnightPair(event)), withheld: feed.withheld };
    }
    if (defectIs(defect, "CONF-O32")) {
      return {
        events: feed.events,
        withheld: withheldExcept(feed.withheld, (entry) => entry.uid === null),
      };
    }
    return feed;
  };

  const evictedMirror = (feed: ResolvedFeed): ResolvedFeed => {
    if (!defectIs(defect, "CONF-O33") || feed.withheld.length === 0) {
      return feed;
    }
    store.replaceObjects(
      store.objects().filter((event) => !event.uid.value.endsWith(":mirror")),
    );
    return defectiveFeed(resolvedFeed());
  };

  const feedNow = (): ResolvedFeed => evictedMirror(defectiveFeed(resolvedFeed()));

  const titleBehind = (id: string): string => {
    const found = store.objects().find((event) => event.id.value === id);
    if (!found) {
      return id;
    }
    return found.content.title;
  };

  const diagnosticsFor = (feed: ResolvedFeed): ListingDiagnostics => {
    const honest = diagnosticsOf(feed, environment.installation);
    if (defectIs(defect, "CONF-O19")) {
      return {
        ...honest,
        withheld: {
          sample: feed.withheld
            .filter((entry) => isMarked(entry.uid?.value ?? "", "CONF-O19"))
            .map((entry) => titleBehind(entry.id?.value ?? ""))
            .toSpliced(-0, 0, ...honest.withheld.sample),
          total: honest.withheld.total,
        },
      };
    }
    if (defectIs(defect, "CONF-O30")) {
      return {
        ...honest,
        unrepresentable: {
          sample: [...honest.unrepresentable.sample, ...honest.selfAuthored.sample],
          total: honest.unrepresentable.total + honest.selfAuthored.total,
        },
      };
    }
    if (defectIs(defect, "CONF-O31")) {
      return {
        ...honest,
        withheld: {
          sample: feed.withheld.map((entry) => entry.uid?.value ?? entry.id?.value ?? ""),
          total: honest.withheld.total,
        },
      };
    }
    if (defectIs(defect, "CONF-O42")) {
      return { ...honest, pagesFetched: honest.pagesFetched + counters.carriedPages };
    }
    return honest;
  };

  const anonymised = (removal: Removal): Removal => {
    if (removal.kind === "outOfScope") {
      return removal;
    }
    const blanked: EventUid = { kind: "eventUid", value: "" };
    return { ...removal, uid: blanked };
  };

  const marksCase = (removal: Removal, id: ConformanceCaseId): boolean => {
    if (removal.kind === "outOfScope") {
      return false;
    }
    return isMarked(removal.uid.value, id);
  };

  const cancelledRather = (removal: Removal): Removal => {
    if (removal.kind === "outOfScope") {
      return removal;
    }
    if (!store.cancelled().some((uid) => uid.value === removal.uid.value)) {
      return removal;
    }
    return { kind: "cancelled", id: removal.id, uid: removal.uid };
  };

  const unattributableTombstones = (): readonly Removal[] =>
    store.unattributableRemovals().map((id) => ({ kind: "outOfScope", id }));

  const removalsFor = (present: readonly ReportedIdentity[]): readonly Removal[] => {
    const honest = [
      ...removalsAgainst(store.reported(), present).map((removal) => cancelledRather(removal)),
      ...unattributableTombstones(),
    ];
    if (defectIs(defect, "CONF-O13")) {
      return honest.map((removal) => {
        if (!marksCase(removal, "CONF-O13")) {
          return removal;
        }
        return anonymised(removal);
      });
    }
    if (defectIs(defect, "CONF-O34")) {
      return honest.map((removal) => plainlyDeleted(removal));
    }
    return honest;
  };

  const recordSpuriousWrite = (): void => {
    if (!defectIs(defect, "CONF-O9") || markedIn("CONF-O9").length === 0) {
      return;
    }
    store.record({
      at: observedAt(),
      intent: {
        kind: "retire",
        calendar: { key: referenceCalendar, access: "readWrite" },
        target: { kind: "deleteHandle", value: "handle-spurious" },
        precondition: { kind: "matchesVersion", version: { kind: "remoteVersion", value: "v1" } },
        reason: "outsideWindow",
      },
      outcome: { kind: "deleted", remote: remoteRefFor("spurious") },
    });
  };

  const provenCoverageOf = (scope: ListingScope): CoverageWindow => {
    if (defectIs(defect, "CONF-O4")) {
      return { covered: scope.window, calendar: scope.calendar };
    }
    if (defectIs(defect, "CONF-O26") && markedIn("CONF-O26").length > 0) {
      const honest = coverageOver(scope);
      return {
        covered: {
          start: honest.covered.start,
          end: {
            kind: "instant",
            value: new Date(Date.parse(honest.covered.end.value) + 90 * dayMs).toISOString(),
          },
        },
        calendar: honest.calendar,
      };
    }
    return coverageOver(scope);
  };

  const snapshotListing = (
    scope: ListingScope,
    at: Instant,
    resuming = false,
  ): ChangeListing => {
    const coverage = provenCoverageOf(scope);
    if (!admitsAnything(coverage.covered)) {
      return emptySnapshot(scope, null);
    }
    const feed = feedNow();
    const present = identitiesOf(feed);
    const removals = removalsFor(present);
    store.setReported(present);
    recordSpuriousWrite();
    const diagnostics = diagnosticsFor(feed);
    if (!resuming && defectIs(defect, "CONF-O41") && markedIn("CONF-O41").length > 0) {
      return truncatedAsPartial(scope, feed, diagnostics);
    }
    return {
      kind: "snapshot",
      scope,
      coverage,
      events: feed.events,
      removals,
      withheld: feed.withheld,
      cursor: mint.mint(scope, store.currentSequence(), at),
      diagnostics,
    };
  };

  const blanked = (event: RemoteEvent): RemoteEvent => {
    if (!defectIs(defect, "CONF-O38") || event.content.recurrence !== null) {
      return event;
    }
    return { ...event, content: { ...event.content, description: null, location: null } };
  };

  const advancedCursor = (
    scope: ListingScope,
    at: Instant,
    resumed: SyncCursor | null,
  ): SyncCursor => {
    if (defectIs(defect, "CONF-O37") && resumed !== null) {
      return resumed;
    }
    return mint.mint(scope, store.currentSequence(), at);
  };

  const deltaListing = (
    scope: ListingScope,
    since: number,
    at: Instant,
    resumed: SyncCursor | null,
  ): ChangeListing => {
    const feed = feedNow();
    const floor = Math.max(since, counters.deltaFloor);
    const present = identitiesOf(feed);
    const removals = removalsFor(present);
    store.setReported(present);
    return {
      kind: "delta",
      scope,
      coverage: coverageOver(scope),
      events: feed.events
        .filter((event) => store.sequenceOf(event.uid.value) > floor)
        .map((event) => blanked(event)),
      removals,
      withheld: feed.withheld,
      cursor: advancedCursor(scope, at, resumed),
      diagnostics: diagnosticsFor(feed),
    };
  };

  const resumedListing = (
    resume: SyncCursor | Continuation,
    scope: ListingScope,
    at: Instant,
  ): Result<ChangeListing> => {
    if (resume.kind === "continuation") {
      const whole = snapshotListing(scope, at, true);
      /*
       * The defect this models is the one a real adapter reaches for: resume where the walk
       * left off and report the tail as though it covered the whole window. The pages
       * already handed back become derivable deletions of events that are plainly present,
       * while every earlier assertion in the case still passes.
       */
      if (defectIs(defect, "CONF-O41") && whole.kind === "snapshot") {
        return {
          ok: true,
          value: { ...whole, events: whole.events.slice(RESUMED_TAIL_FROM) },
        };
      }
      return { ok: true, value: whole };
    }
    const verdict = mint.verify(resume, scope);
    switch (verdict.kind) {
      case "current": {
        return { ok: true, value: deltaListing(scope, verdict.sequence, at, resume) };
      }
      case "superseded": {
        if (defectIs(defect, "CONF-O10")) {
          return { ok: true, value: snapshotListing(scope, at) };
        }
        return { ok: true, value: cursorLostListing(scope) };
      }
      case "foreignScope": {
        if (defectIs(defect, "CONF-O11")) {
          return { ok: true, value: deltaListing(scope, 0, at, resume) };
        }
        return { ok: true, value: cursorLostListing(scope) };
      }
      case "unknown": {
        if (defectIs(defect, "CONF-O40")) {
          throw new Error("the reference mutant cannot read the cursor it was handed");
        }
        return { ok: true, value: cursorLostListing(scope) };
      }
      default: {
        return assertNever(verdict);
      }
    }
  };

  const corruptAnswer = (scope: ListingScope, at: Instant): Result<ChangeListing> => {
    if (defectIs(defect, "CONF-O12")) {
      return { ok: true, value: snapshotListing(scope, at) };
    }
    return { ok: true, value: cursorLostListing(scope) };
  };

  const isUnusable = (event: RemoteEvent): boolean =>
    constraintViolatedBy(event.content) !== null;

  const contentProvokedFailure = (): ProviderFailure | null => {
    if (defectIs(defect, "CONF-O23")) {
      const provoking = store
        .objects()
        .some((event) => event.content.title.toLowerCase().includes("rate limit"));
      if (provoking) {
        return { kind: "rateLimited", retryAfter: null, scope: "perUser" };
      }
    }
    if (defectIs(defect, "CONF-O6") && markedIn("CONF-O6").some((event) => isUnusable(event))) {
      return { kind: "transport", status: 500, disposition: "permanent" };
    }
    return null;
  };

  const buildListing = (request: ListChangesRequest): Result<ChangeListing> => {
    const at = observedAt();
    const provoked = contentProvokedFailure();
    if (provoked !== null) {
      return { ok: false, failure: provoked };
    }
    if (store.corruptKnownRows().length > 0) {
      return corruptAnswer(request.scope, at);
    }
    if (request.resume === null) {
      return { ok: true, value: snapshotListing(request.scope, at) };
    }
    return resumedListing(request.resume, request.scope, at);
  };

  const declaredThrottleFor = (status: number): ThrottleSignal | null => {
    if (defectIs(defect, "CONF-O46")) {
      return null;
    }
    return referenceCapabilities.throttleSignals.find((signal) => signal.status === status) ?? null;
  };

  const failureOfError = (error: unknown): ProviderFailure => {
    if (!(error instanceof TransportStatus)) {
      return failureOfTransportError(error);
    }
    const signal = declaredThrottleFor(error.status);
    if (signal === null) {
      return { kind: "transport", status: error.status, disposition: "permanent" };
    }
    if (!signal.hasRetryAfter) {
      return { kind: "rateLimited", retryAfter: null, scope: referenceCapabilities.quotaScope };
    }
    return {
      kind: "rateLimited",
      retryAfter: error.retryAfter,
      scope: referenceCapabilities.quotaScope,
    };
  };

  const attemptListing = async (request: ListChangesRequest): Promise<Result<ChangeListing>> => {
    try {
      return await environment.transport.run("listChanges", () =>
        Promise.resolve(buildListing(request)),
      );
    } catch (error) {
      const failure = failureOfError(error);
      if (defectIs(defect, "CONF-O2") && failure.kind === "transport" && failure.status === 503) {
        return { ok: true, value: emptySnapshot(request.scope, null) };
      }
      return { ok: false, failure };
    }
  };

  const sleptBetweenAttempts = async (
    milliseconds: number,
    context: OperationContext,
  ): Promise<boolean> => {
    const waking = AbortSignal.any([lifetime.signal, context.signal]);
    try {
      await environment.clock.sleep(milliseconds, waking);
      return true;
    } catch {
      return false;
    }
  };

  const attemptCeiling = (context: OperationContext): number => {
    if (defectIs(defect, "CONF-L1")) {
      return context.retryBudget.maxAttempts + 1;
    }
    return context.retryBudget.maxAttempts;
  };

  const leadListing = async (
    key: string,
    request: ListChangesRequest,
    context: OperationContext,
  ): Promise<Result<ChangeListing>> => {
    const ceiling = attemptCeiling(context);
    for (const attempt of attemptsUpTo(ceiling)) {
      counters.attemptsSpent = Math.max(counters.attemptsSpent, attempt);
      counters.attemptsAllowed = context.retryBudget.maxAttempts;
      const answered = await attemptListing(request);
      if (poisoned.has(key)) {
        poisoned.delete(key);
        return { ok: false, failure: aborted };
      }
      if (answered.ok || !isRetryable(answered.failure) || attempt === ceiling) {
        return answered;
      }
      const slept = await sleptBetweenAttempts(retryDelayFor(answered.failure, context), context);
      if (!slept) {
        return { ok: false, failure: aborted };
      }
    }
    return { ok: false, failure: exhausted };
  };

  const flightKeyOf = (request: ListChangesRequest): string => {
    if (defectIs(defect, "CONF-L6")) {
      return request.scope.calendar.calendar.value;
    }
    return canonicalise({
      scope: scopeKeyOf(request.scope),
      resume: request.resume?.value ?? "",
    });
  };

  const cloned = (answered: Result<ChangeListing>): Result<ChangeListing> => {
    if (defectIs(defect, "CONF-L5")) {
      return answered;
    }
    return structuredClone(answered);
  };

  const deadlineAnswers = (): DeadlineAnswers => {
    if (defectIs(defect, "CONF-L2")) {
      return { onDeadline: aborted, onAbort: aborted };
    }
    if (defectIs(defect, "CONF-L3")) {
      return { onDeadline: exhausted, onAbort: exhausted };
    }
    return standardAnswers;
  };

  const reattemptedAlone = (
    request: ListChangesRequest,
    answered: Result<ChangeListing>,
  ): Promise<Result<ChangeListing>> => {
    if (answered.ok || !defectIs(defect, "CONF-L4") || answered.failure.kind !== "transport") {
      return Promise.resolve(answered);
    }
    return attemptListing(request);
  };

  const rememberFailure = (answered: Result<ChangeListing>): Result<ChangeListing> => {
    if (answered.ok) {
      return answered;
    }
    if (defectIs(defect, "CONF-O24")) {
      counters.deltaFloor = store.currentSequence();
    }
    if (defectIs(defect, "CONF-O42")) {
      counters.carriedPages += 1;
    }
    return answered;
  };

  const noteAbortedCaller = (key: string, context: OperationContext): void => {
    if (!context.signal.aborted) {
      return;
    }
    if (defectIs(defect, "CONF-L9") && counters.callersInFlight === 3) {
      poisoned.add(key);
    }
    if (defectIs(defect, "CONF-L10") && counters.callersInFlight > environment.concurrency) {
      counters.leakedPermits += 1;
    }
  };

  const listChanges = async (
    request: ListChangesRequest,
    context: OperationContext,
  ): Promise<Result<ChangeListing>> => {
    counters.callersInFlight += 1;
    if (counters.callersInFlight === 1) {
      counters.abortsInBurst = 0;
    }
    if (context.signal.aborted) {
      counters.abortsInBurst += 1;
    }
    const key = flightKeyOf(request);
    try {
      noteAbortedCaller(key, context);
      if (counters.leakedPermits > 0 && !context.signal.aborted) {
        counters.leakedPermits -= 1;
        return { ok: false, failure: exhausted };
      }
      if (defectIs(defect, "CONF-L11") && counters.callersInFlight > environment.concurrency) {
        await Promise.resolve();
        if (counters.abortsInBurst === 0) {
          throw new Error("the reference mutant dropped a task out of its fan-out");
        }
      }
      if (defectIs(defect, "CONF-L12") && context.signal.aborted) {
        environment.transport.run("listChanges", () => answeredWith(null)).catch(noop);
      }
      const leadWithinItsOwnBudget = (): Promise<Result<ChangeListing>> =>
        raceDeadline(context, deadlineAnswers(), () => leadListing(key, request, context));
      const answered = await raceDeadline(context, deadlineAnswers(), () =>
        flights.run(key, leadWithinItsOwnBudget),
      );
      if (!answered.ok && answered.failure.kind === "notAttempted") {
        flights.abandon(key);
      }
      return cloned(rememberFailure(await reattemptedAlone(request, answered)));
    } finally {
      counters.callersInFlight -= 1;
    }
  };

  const normalized = (content: EditableContent): NormalizedContent<"reference"> => {
    if (defectIs(defect, "CONF-O20")) {
      return {
        kind: "normalized",
        provider: "reference",
        content: rewriteAsProviderWould(content),
        fingerprint: fingerprintWith(sortedKeys, content, environment.hash),
      };
    }
    const rewritten = rewriteAsProviderWould(content);
    if (defectIs(defect, "CONF-O21")) {
      return {
        kind: "normalized",
        provider: "reference",
        content: rewritten,
        fingerprint: fingerprintWith(insertionOrderKeys, rewritten, environment.hash),
      };
    }
    return {
      kind: "normalized",
      provider: "reference",
      content: rewritten,
      fingerprint: fingerprintWith(sortedKeys, rewritten, environment.hash),
    };
  };

  const refusalFor = (content: EditableContent): ProviderFailure | null => {
    const constraint = constraintViolatedBy(content);
    if (constraint === null) {
      return null;
    }
    if (defectIs(defect, "CONF-O29") && constraint === "invertedRange") {
      return null;
    }
    if (defectIs(defect, "CONF-O35") && constraint === "recurrenceDialect") {
      return null;
    }
    if (defectIs(defect, "CONF-O43") && constraint === "zoneIdentifier") {
      return null;
    }
    return { kind: "unrepresentable", constraint };
  };

  const objectFor = (
    uid: string,
    content: NormalizedContent<"reference">,
    revision: number,
  ): RemoteEvent => ({
    ...remoteRefFor(uid),
    uid: { kind: "eventUid", value: uid },
    calendar: referenceCalendar,
    revision,
    version: { kind: "remoteVersion", value: versionFor(uid, revision) },
    content: content.content,
    fingerprint: content.fingerprint,
    provenance: { kind: "ours", installation: environment.installation },
  });

  const replaceObject = (uid: string, next: RemoteEvent | null): void => {
    const remaining = store.objects().filter((event) => event.uid.value !== uid);
    if (next === null) {
      store.replaceObjects(remaining);
      return;
    }
    store.replaceObjects([...remaining, next]);
  };

  const disturbCanary = (): void => {
    if (!defectIs(defect, "CONF-O17")) {
      return;
    }
    const canary = markedIn("CONF-O17").at(0);
    if (!canary) {
      return;
    }
    replaceObject(canary.uid.value, { ...canary, revision: canary.revision + 1 });
  };

  const echoFor = (uid: string): EchoVerdict => {
    if (defectIs(defect, "CONF-O18") && isMarked(uid, "CONF-O18")) {
      return { kind: "notObserved" };
    }
    return { kind: "matched" };
  };

  const keyOrder = (): KeyOrder => {
    if (defectIs(defect, "CONF-O21")) {
      return insertionOrderKeys;
    }
    return sortedKeys;
  };

  const submittedEncoding = (content: EditableContent): string => {
    if (defectIs(defect, "CONF-O20")) {
      return encodeIdentity(keyOrder(), false, content);
    }
    if (defectIs(defect, "CONF-O21")) {
      return encodeIdentity(keyOrder(), true, content);
    }
    return encodeIdentity(keyOrder(), true, rewriteAsProviderWould(content));
  };

  const storedEncoding = (content: EditableContent): string =>
    encodeIdentity(keyOrder(), true, content);

  const decidedAs = (outcome: Result<WriteOutcome>): DecidedWrite => ({ outcome, commit: noop });

  const decidedReplay = (
    uid: string,
    existing: RemoteEvent,
    content: NormalizedContent<"reference">,
  ): DecidedWrite => {
    if (!defectIs(defect, "CONF-O14") || !isMarked(uid, "CONF-O14")) {
      return decidedAs({
        ok: true,
        value: { kind: "alreadyExists", remote: remoteRefFor(uid), version: existing.version },
      });
    }
    const duplicate = objectFor(`${uid}-duplicate`, content, 1);
    return {
      outcome: {
        ok: true,
        value: {
          kind: "created",
          remote: remoteRefFor(duplicate.uid.value),
          version: duplicate.version,
          echo: echoFor(uid),
        },
      },
      commit: () => {
        store.replaceObjects([...store.objects(), duplicate]);
      },
    };
  };

  const decidedContention = (uid: string, existing: RemoteEvent): DecidedWrite => {
    const commit = (): void => {
      if (!defectIs(defect, "CONF-O25")) {
        return;
      }
      replaceObject(uid, null);
    };
    if (defectIs(defect, "CONF-O15")) {
      return {
        outcome: {
          ok: true,
          value: { kind: "unchanged", remote: remoteRefFor(uid), version: existing.version },
        },
        commit,
      };
    }
    return {
      outcome: {
        ok: true,
        value: {
          kind: "conflict",
          remote: remoteRefFor(uid),
          observed: { kind: "matchesVersion", version: existing.version },
        },
      },
      commit,
    };
  };

  const decideCreate = (
    intent: Extract<WriteIntent<"reference">, { kind: "create" }>,
  ): DecidedWrite => {
    const refusal = refusalFor(intent.content.content);
    if (refusal !== null) {
      return decidedAs({ ok: false, failure: refusal });
    }
    const content = normalized(intent.content.content);
    const uid = intent.idempotencyKey.value;
    const existing = store.objects().find((event) => event.uid.value === uid);
    if (existing && storedEncoding(existing.content) === submittedEncoding(intent.content.content)) {
      return decidedReplay(uid, existing, content);
    }
    if (existing) {
      return decidedContention(uid, existing);
    }
    const created = objectFor(uid, content, 1);
    return {
      outcome: {
        ok: true,
        value: {
          kind: "created",
          remote: remoteRefFor(uid),
          version: created.version,
          echo: echoFor(uid),
        },
      },
      commit: () => {
        store.replaceObjects([...store.objects(), created]);
        disturbCanary();
      },
    };
  };

  const preconditionHolds = (
    existing: RemoteEvent,
    precondition: Extract<WriteIntent<"reference">, { kind: "update" }>["precondition"],
  ): boolean => {
    if (defectIs(defect, "CONF-O39") && isMarked(existing.uid.value, "CONF-O39")) {
      return true;
    }
    if (precondition.kind === "matchesVersion") {
      return precondition.version.value === existing.version.value;
    }
    return precondition.fingerprint.value === existing.fingerprint.value;
  };

  const decideUpdate = (
    intent: Extract<WriteIntent<"reference">, { kind: "update" }>,
  ): DecidedWrite => {
    const existing = store.objects().find((event) => event.id.value === intent.target.value);
    if (!existing) {
      return decidedAs({
        ok: false,
        failure: { kind: "notFound", calendar: referenceCalendar, event: intent.target },
      });
    }
    if (!preconditionHolds(existing, intent.precondition)) {
      return decidedAs(staleConflict(existing));
    }
    const refusal = refusalFor(intent.content.content);
    if (refusal !== null) {
      return decidedAs({ ok: false, failure: refusal });
    }
    const next = objectFor(
      existing.uid.value,
      normalized(intent.content.content),
      existing.revision + 1,
    );
    return {
      outcome: {
        ok: true,
        value: {
          kind: "updated",
          remote: remoteRefFor(existing.uid.value),
          version: next.version,
          echo: echoFor(existing.uid.value),
        },
      },
      commit: () => {
        replaceObject(existing.uid.value, next);
        disturbCanary();
      },
    };
  };

  const decideRemoval = (
    intent: Extract<WriteIntent<"reference">, { kind: "delete" } | { kind: "retire" }>,
  ): DecidedWrite => {
    const existing = store
      .objects()
      .find((event) => event.deleteHandle.value === intent.target.value);
    if (!existing) {
      return decidedAs({
        ok: true,
        value: {
          kind: "alreadyAbsent",
          remote: { id: { kind: "remoteEventId", value: "absent" }, deleteHandle: intent.target },
        },
      });
    }
    if (!preconditionHolds(existing, intent.precondition)) {
      return decidedAs(staleConflict(existing));
    }
    return {
      outcome: { ok: true, value: { kind: "deleted", remote: remoteRefFor(existing.uid.value) } },
      commit: () => {
        replaceObject(existing.uid.value, null);
      },
    };
  };

  const decideWrite = (intent: WriteIntent<"reference">): DecidedWrite => {
    switch (intent.kind) {
      case "create": {
        return decideCreate(intent);
      }
      case "update": {
        return decideUpdate(intent);
      }
      case "delete":
      case "retire": {
        return decideRemoval(intent);
      }
      default: {
        return assertNever(intent);
      }
    }
  };

  const logWrite = (intent: WriteIntent<"reference">, answered: Result<WriteOutcome>): void => {
    if (!answered.ok) {
      return;
    }
    const at = observedAt();
    if (defectIs(defect, "CONF-O36") && intent.kind === "update") {
      store.record({
        at,
        intent: {
          kind: "delete",
          calendar: intent.calendar,
          target: { kind: "deleteHandle", value: `handle-${intent.target.value}` },
          precondition: intent.precondition,
          reason: "sourceDeleted",
        },
        outcome: { kind: "deleted", remote: remoteRefFor(intent.target.value) },
      });
    }
    store.record({ at, intent, outcome: answered.value });
  };

  const committed = (decided: DecidedWrite, intent: WriteIntent<"reference">): DecidedWrite => {
    decided.commit();
    logWrite(intent, decided.outcome);
    return decided;
  };

  const interleavesItsCommit = (): boolean => defectIs(defect, "CONF-O44");

  const attemptWrite = async (intent: WriteIntent<"reference">): Promise<Result<WriteOutcome>> => {
    try {
      return await environment.transport.run("write", (): Promise<Result<WriteOutcome>> => {
        const decided = decideWrite(intent);
        if (!interleavesItsCommit()) {
          return Promise.resolve(committed(decided, intent).outcome);
        }
        return Promise.resolve()
          .then(() => committed(decided, intent))
          .then((settled) => settled.outcome);
      });
    } catch (error) {
      return { ok: false, failure: failureOfError(error) };
    }
  };

  const write = (
    intent: WriteIntent<"reference">,
    context: OperationContext,
  ): Promise<Result<WriteOutcome>> =>
    raceDeadline(context, deadlineAnswers(), () => attemptWrite(intent));

  const enumerateCalendars = (account: AccountId): CalendarEnumeration => ({
    kind: "snapshot",
    account,
    calendars: [
      {
        key: referenceCalendar,
        displayName: "Reference calendar",
        timeZone: { kind: "zoneId", value: "UTC" },
        access: "readWrite",
      },
    ],
  });

  const listCalendars = (
    account: AccountId,
    context: OperationContext,
  ): Promise<Result<CalendarEnumeration>> =>
    raceDeadline(context, deadlineAnswers(), async () => {
      try {
        return await environment.transport.run("listCalendars", () =>
          Promise.resolve({ ok: true, value: enumerateCalendars(account) }),
        );
      } catch (error) {
        return { ok: false, failure: failureOfTransportError(error) };
      }
    });

  const armAbandonedTimer = (): void => {
    if (!defectIs(defect, "CONF-L8")) {
      return;
    }
    environment.clock.sleep(conformanceLimits.deadlineMs, lifetime.signal).catch(() => null);
  };

  const listChangesWithDefect = (
    request: ListChangesRequest,
    context: OperationContext,
  ): Promise<Result<ChangeListing>> => {
    armAbandonedTimer();
    return listChanges(request, context);
  };

  const noLeaseOutstanding = (): Promise<void> =>
    holds(flights.inFlightKeys() === 0, "the reference provider still holds a coalescing lease");

  const noCallerOutstanding = (): Promise<void> =>
    holds(counters.callersInFlight === 0, "the reference provider still counts a caller as in flight");

  const noAbandonedFlight = (): Promise<void> =>
    holds(
      flights.inFlightKeys() === 0,
      "a flight abandoned at its deadline is still registered against its key",
    );

  const noCancellationResidue = (): Promise<void> =>
    holds(
      poisoned.size === 0 && counters.leakedPermits === 0,
      "an aborted caller left a poisoned key or a leaked permit behind",
    );

  const attemptsWithinBudget = (): Promise<void> =>
    holds(
      counters.attemptsSpent <= counters.attemptsAllowed,
      `the reference provider spent ${counters.attemptsSpent} attempts of ${counters.attemptsAllowed}`,
    );

  const noKeyStillHeld = (): Promise<void> =>
    holds(
      flights.inFlightKeys() === 0 && counters.callersInFlight === 0,
      "concurrent callers over one key left the key held after they all settled",
    );

  const oneCalendarBehindEveryDeletion = (): Promise<void> =>
    holds(
      new Set(store.objects().map((event) => event.calendar.calendar.value)).size <= 1,
      "the reference store holds objects from two calendars, so a deletion could cross between them",
    );

  return {
    contract: {
      provider: {
        capabilities: referenceCapabilities,
        listCalendars,
        listChanges: listChangesWithDefect,
        normalize: (content: EditableContent) => {
          const refusal = refusalFor(content);
          if (refusal !== null) {
            return { ok: false, failure: refusal };
          }
          return { ok: true, value: normalized(content) };
        },
        write,
      },
      fingerprint: referenceFingerprintContract,
      conformance: {
        leaseReleasedOnThrow: noLeaseOutstanding,
        followerRejectsWhenLeaderFails: noCallerOutstanding,
        deadlineOnNeverResolvingStub: noAbandonedFlight,
        abortMidFlightCleansUp: noCancellationResidue,
        retryCeilingProven: attemptsWithinBudget,
        concurrentSameKeyDoesNotDeadlock: noKeyStillHeld,
        deletionInputsShareOneCalendar: oneCalendarBehindEveryDeletion,
      },
    },
    seed: (seed: ProviderSeed) => {
      store.seed(seed);
      return Promise.resolve();
    },
    inspect: () =>
      Promise.resolve({ objects: store.objects(), writeLog: store.writeLog() }),
    dispose: () => {
      lifetime.abort();
      return Promise.resolve();
    },
  };
};

export { createReference, remoteRefFor, versionFor };
export type { ReferenceOptions };
