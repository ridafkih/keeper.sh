import {
  syncCalendar,
  getEventsForCalendarsWithDiagnostics,
  getEventMappingsForDestination,
  createDatabaseFlush,
  createGoogleUserRateLimiter,
  createRedisRateLimiter,
  buildCalendarBackoffState,
  RESET_CALENDAR_BACKOFF_STATE,
  createSyncWindow,
  getMappedSourceCalendarIds,
  namesEventInDestination,
  withSourceIngestLocks,
  getConfigurableSyncWindow,
  intersectSyncWindows,
  overlapsTimeWindow,
} from "@keeper.sh/calendar";
import { OUTLOOK_REQUESTS_PER_MINUTE } from "@keeper.sh/constants";
import { syncRangeSchema } from "@keeper.sh/data-schemas";
import type { Plan } from "@keeper.sh/data-schemas";
import type { RedisRateLimiter } from "@keeper.sh/calendar";
import type { SafeFetchOptions } from "@keeper.sh/calendar/safe-fetch";
import type {
  EventMapping,
  DestinationEventReadDiagnostics,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  ReconciliationScope,
  RefreshLockStore,
  EventPresence,
  EventPresenceStatus,
  EventVerificationTarget,
  RemoteEvent,
  SyncProgressUpdate,
  SyncWindow,
} from "@keeper.sh/calendar";
import {
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { withDatabasePoolWindow } from "@keeper.sh/database";
import type { DatabasePoolWindow } from "@keeper.sh/database";
import { and, arrayContains, eq, inArray, isNull } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type Redis from "ioredis";
import {
  getErrorMessage,
  resolveDestinationAttemptVerdict,
  resolveThrownDestinationVerdict,
} from "./destination-errors";
import type { DestinationAttemptVerdict } from "./destination-errors";
import { resolveSyncProvider } from "./resolve-provider";
import type { OAuthConfig } from "./resolve-provider";
import {
  createMappingMutationLockId,
  createSyncLock,
} from "./sync-lock";
import type { SyncLockHandle } from "./sync-lock";

/*
 * Google's quota is shared across ingest and push, so the push lane claims only its
 * reserved share of the one per-user key. Outlook throttles per mailbox instead, so it
 * gets a key of its own at the mailbox ceiling.
 */
const createProviderRateLimiter = (
  redis: Redis,
  userId: string,
  provider: string,
): RedisRateLimiter | undefined => {
  if (provider === "google") {
    return createGoogleUserRateLimiter(redis, userId, "push");
  }
  if (provider !== "outlook") {
    return;
  }
  return createRedisRateLimiter(redis, `ratelimit:${userId}:outlook`, {
    requestsPerMinute: OUTLOOK_REQUESTS_PER_MINUTE,
  });
};

const resetDestinationBackoff = async (
  database: BunSQLDatabase,
  calendarId: string,
): Promise<void> => {
  await database
    .update(calendarsTable)
    .set(RESET_CALENDAR_BACKOFF_STATE)
    .where(eq(calendarsTable.id, calendarId));
};

const matchesObservedNextAttempt = (nextAttemptAt: Date | null) => {
  if (nextAttemptAt === null) {
    return isNull(calendarsTable.nextAttemptAt);
  }
  return eq(calendarsTable.nextAttemptAt, nextAttemptAt);
};

// Compare-and-set: a reconnect or another worker's verdict landing mid-run must beat a verdict computed against retry state that no longer exists.
const matchesObservedRetryState = (destination: DestinationAttempt) =>
  and(
    eq(calendarsTable.id, destination.calendarId),
    eq(calendarsTable.failureCount, destination.failureCount),
    matchesObservedNextAttempt(destination.nextAttemptAt),
  );

const applyDestinationBackoff = async (
  database: BunSQLDatabase,
  destination: DestinationAttempt,
): Promise<void> => {
  const backoffState = buildCalendarBackoffState(destination.failureCount);

  await database
    .update(calendarsTable)
    .set(backoffState)
    .where(matchesObservedRetryState(destination));
};

const extractNumericField = (event: Record<string, unknown> | null | undefined, key: string): number => {
  if (!event) {
    return 0;
  }
  const value = event[key];
  if (typeof value === "number") {
    return value;
  }
  return 0;
};

interface SyncConfig {
  destinationCalendarId: string;
  database: BunSQLDatabase;
  redis: Redis;
  encryptionKey?: string;
  oauthConfig: OAuthConfig;
  plan: Plan;
  refreshLockStore?: RefreshLockStore | null;
  safeFetchOptions?: SafeFetchOptions;
  deadlineMs?: number;
  abortSignal?: AbortSignal;
}

interface SyncDestinationsResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
  errors: string[];
  syncEvents: Record<string, unknown>[];
}

const EMPTY_RESULT: SyncDestinationsResult = {
  added: 0,
  addFailed: 0,
  removed: 0,
  removeFailed: 0,
  errors: [],
  syncEvents: [],
};

interface DestinationLocalState {
  localEvents: MaterializedSyncableEvent[];
  existingMappings: EventMapping[];
}

interface DestinationReconciliationContext {
  eventReadDiagnostics: DestinationEventReadDiagnostics;
  localReadDurationMs: number;
  authoritativeWindow: SyncWindow | null;
  requestedWindow: SyncWindow;
  remoteReadDurationMs: number;
  sourceCalendarIdsAtLocalRead: string[];
  sourceCalendarIdsBeforeRemoteRead: string[];
  verification?: DestinationVerificationReport | null;
  verifiedSourceCalendarCount: number;
}

const roundDuration = (durationMs: number): number =>
  Math.round(durationMs * 100) / 100;

const measurePhase = async <TResult>(
  run: () => Promise<TResult>,
): Promise<{ durationMs: number; value: TResult }> => {
  const startedAt = performance.now();
  const value = await run();
  return { durationMs: roundDuration(performance.now() - startedAt), value };
};

interface StoredSourceCoverage {
  ingestFutureRange: string | null;
  ingestHistoricRange: string | null;
  ingestWindowEnd: Date | null;
  ingestWindowRecordedAt: Date | null;
  ingestWindowStart: Date | null;
}

const resolveStoredSourceCoverage = (source: StoredSourceCoverage): SyncWindow | null => {
  if (
    !source.ingestWindowStart
    || !source.ingestWindowEnd
    || !source.ingestWindowRecordedAt
    || !Number.isFinite(source.ingestWindowRecordedAt.getTime())
    || !syncRangeSchema.allows(source.ingestHistoricRange)
    || !syncRangeSchema.allows(source.ingestFutureRange)
  ) {
    return null;
  }
  try {
    return createSyncWindow(source.ingestWindowStart, source.ingestWindowEnd);
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
};

interface SourceAuthority {
  aggregateWindow: SyncWindow | null;
  sourceWindows: Map<string, SyncWindow>;
}

const createAggregateAuthorityWindow = (
  sourceCalendarIds: string[],
  sourceWindows: ReadonlyMap<string, SyncWindow>,
  requestedWindow: SyncWindow,
): SyncWindow | null => {
  /*
   * A destination with no mapped sources is not authoritative over anything. Granting
   * it the requested window lets a freshly imported, unmapped calendar delete every
   * Keeper-tagged event another calendar row put on that remote calendar.
   */
  if (sourceCalendarIds.length === 0) {
    return null;
  }
  if (sourceWindows.size !== sourceCalendarIds.length) {
    return null;
  }

  let aggregateWindow: SyncWindow | null = requestedWindow;
  for (const sourceCalendarId of sourceCalendarIds) {
    const sourceWindow = sourceWindows.get(sourceCalendarId);
    if (!sourceWindow) {
      return null;
    }
    aggregateWindow = intersectSyncWindows(aggregateWindow, sourceWindow);
    if (!aggregateWindow) {
      return null;
    }
  }
  return aggregateWindow;
};

const resolveSourceAuthority = async (
  database: Pick<BunSQLDatabase, "select">,
  sourceCalendarIds: string[],
  requestedWindow: SyncWindow,
): Promise<SourceAuthority> => {
  if (sourceCalendarIds.length === 0) {
    return { aggregateWindow: null, sourceWindows: new Map() };
  }
  const sources = await database
    .select({
      id: calendarsTable.id,
      ingestFutureRange: calendarsTable.ingestFutureRange,
      ingestHistoricRange: calendarsTable.ingestHistoricRange,
      ingestWindowEnd: calendarsTable.ingestWindowEnd,
      ingestWindowRecordedAt: calendarsTable.ingestWindowRecordedAt,
      ingestWindowStart: calendarsTable.ingestWindowStart,
    })
    .from(calendarsTable)
    .where(inArray(calendarsTable.id, sourceCalendarIds));

  const sourceWindows = new Map<string, SyncWindow>();
  for (const source of sources) {
    const sourceCoverage = resolveStoredSourceCoverage(source);
    if (!sourceCoverage) {
      continue;
    }
    const sourceWindow = intersectSyncWindows(requestedWindow, sourceCoverage);
    if (sourceWindow) {
      sourceWindows.set(source.id, sourceWindow);
    }
  }
  return {
    aggregateWindow: createAggregateAuthorityWindow(
      sourceCalendarIds,
      sourceWindows,
      requestedWindow,
    ),
    sourceWindows,
  };
};

const narrowSourceAuthority = (
  initialSourceWindows: ReadonlyMap<string, SyncWindow>,
  currentSourceWindows: ReadonlyMap<string, SyncWindow>,
): Map<string, SyncWindow> => {
  const narrowedSourceWindows = new Map<string, SyncWindow>();
  for (const [sourceCalendarId, initialWindow] of initialSourceWindows) {
    const currentWindow = currentSourceWindows.get(sourceCalendarId);
    if (!currentWindow) {
      continue;
    }
    const narrowedWindow = intersectSyncWindows(initialWindow, currentWindow);
    if (narrowedWindow) {
      narrowedSourceWindows.set(sourceCalendarId, narrowedWindow);
    }
  }
  return narrowedSourceWindows;
};

const getBoundingSourceAuthorityWindow = (
  sourceWindows: ReadonlyMap<string, SyncWindow>,
): SyncWindow | null => {
  let timeMin: Date | null = null;
  let timeMax: Date | null = null;
  for (const sourceWindow of sourceWindows.values()) {
    const { timeMax: sourceTimeMax, timeMin: sourceTimeMin } = sourceWindow;
    if (!timeMin || sourceTimeMin < timeMin) {
      timeMin = sourceTimeMin;
    }
    if (!timeMax || sourceTimeMax > timeMax) {
      timeMax = sourceTimeMax;
    }
  }
  if (!timeMin || !timeMax) {
    return null;
  }
  return createSyncWindow(timeMin, timeMax);
};

const haveSourceCalendarsChanged = (
  beforeRemoteRead: string[],
  atLocalRead: string[],
): boolean => {
  if (beforeRemoteRead.length !== atLocalRead.length) {
    return true;
  }

  const orderedBeforeRemoteRead = beforeRemoteRead.toSorted();
  const orderedAtLocalRead = atLocalRead.toSorted();
  return orderedBeforeRemoteRead.some(
    (calendarId, index) => calendarId !== orderedAtLocalRead[index],
  );
};

/*
 * Every series a calendar withholds for exceeding the occurrence budget lands in this
 * list, so a pathological source can push thousands of UIDs onto one log line. The
 * adjacent over_budget_series_count still carries the uncapped total, which is what
 * makes a truncated sample safe to read.
 */
const OVER_BUDGET_SERIES_UID_SAMPLE_SIZE = 20;

interface DestinationReconciliationScopeContext {
  authoritativeMappingIds: ReadonlySet<string> | null;
  authoritativeSourceWindows: ReadonlyMap<string, SyncWindow>;
  authoritativeWindow: SyncWindow | null;
  eventReadDiagnostics: DestinationEventReadDiagnostics;
  requestedWindow: SyncWindow;
  sourceCalendarIdsAtLocalRead: string[];
  unverifiedMappingIds?: ReadonlySet<string>;
}

/*
 * A series withheld for exceeding the occurrence budget is absent from the local read
 * for a technical limit, not because the source dropped it. Reconciliation needs that
 * distinction, or every mirror of the series is deleted at the provider and re-added
 * the moment the series comes back under budget.
 */
const createDestinationReconciliationScope = (
  context: DestinationReconciliationScopeContext,
): ReconciliationScope => ({
  ...(context.authoritativeMappingIds && {
    authoritativeMappingIds: context.authoritativeMappingIds,
  }),
  authoritativeSourceWindows: context.authoritativeSourceWindows,
  authoritativeWindow: context.authoritativeWindow,
  configuredSourceCalendarIds: new Set(context.sourceCalendarIdsAtLocalRead),
  requestedWindow: context.requestedWindow,
  ...(context.unverifiedMappingIds && {
    unverifiedMappingIds: context.unverifiedMappingIds,
  }),
  withheldSourceEventStateIds: new Set(
    context.eventReadDiagnostics.overBudgetSourceEventStateIds,
  ),
});

/*
 * Verification is a bounded budget, so a run routinely ends with mappings whose state was
 * never established: the budget ran out before them, or the provider answered that it could
 * not tell. Counted apart from present and absent, a run that deliberately did nothing about
 * them is visible in production instead of reading like a healthy one.
 */
interface DestinationVerificationReport {
  /*
   * Where this pass stopped asking, carried to the next cycle so the budget resumes after it.
   * Null means the next cycle starts from the top: the pass covered every unconfirmed mapping,
   * or the caller does not carry a cursor at all. Absent when the caller never asked to rotate.
   */
  nextVerificationCursor?: string | null;
  unverifiedCount: number;
  unverifiedMappingIds: ReadonlySet<string>;
  verifiedAbsentCount: number;
  verifiedPresentCount: number;
}

/* Counts sum across the destinations a run touches, so each is a run total, not a gauge. */
const createVerificationWideEventFields = (
  verification?: DestinationVerificationReport | null,
): Record<string, number> => {
  if (!verification) {
    return {};
  }
  return {
    "reconciliation.verification.unverified_count": verification.unverifiedCount,
    "reconciliation.verification.verified_absent_count": verification.verifiedAbsentCount,
    "reconciliation.verification.verified_present_count": verification.verifiedPresentCount,
  };
};

const createDestinationReconciliationWideEventFields = (
  context: DestinationReconciliationContext,
): Record<string, string | number | boolean> => ({
  "local_event_states.candidate_count": context.eventReadDiagnostics.candidateEventStateCount,
  "local_event_states.empty_time_range_count": context.eventReadDiagnostics.emptyTimeRangeCount,
  "local_event_states.excluded_by_sync_policy_count": context.eventReadDiagnostics.excludedBySyncPolicyCount,
  "local_event_states.inverted_time_range_count": context.eventReadDiagnostics.invertedTimeRangeCount,
  "local_event_states.materialized_count": context.eventReadDiagnostics.materializedEventCount,
  "local_event_states.missing_source_event_uid_count": context.eventReadDiagnostics.missingSourceEventUidCount,
  "local_event_states.outside_reconciliation_window_count": context.eventReadDiagnostics.outsideReconciliationWindowCount,
  "local_event_states.over_budget_series_count": context.eventReadDiagnostics.overBudgetSourceEventUids.length,
  "local_event_states.over_budget_series_uids": context.eventReadDiagnostics.overBudgetSourceEventUids
    .slice(0, OVER_BUDGET_SERIES_UID_SAMPLE_SIZE)
    .join(","),
  "local_event_states.syncable_count": context.eventReadDiagnostics.syncableEventCount,
  "reconciliation.local_read.duration_ms": context.localReadDurationMs,
  "reconciliation.remote_read.duration_ms": context.remoteReadDurationMs,
  "reconciliation.source_calendars.at_local_read_count": context.sourceCalendarIdsAtLocalRead.length,
  "reconciliation.source_calendars.before_remote_read_count": context.sourceCalendarIdsBeforeRemoteRead.length,
  "reconciliation.source_calendars.verified_count": context.verifiedSourceCalendarCount,
  "reconciliation.source_calendars.changed_during_remote_read": haveSourceCalendarsChanged(
    context.sourceCalendarIdsBeforeRemoteRead,
    context.sourceCalendarIdsAtLocalRead,
  ),
  "reconciliation.authority.verified": context.authoritativeWindow !== null,
  ...createVerificationWideEventFields(context.verification),
  "reconciliation.window.requested_time_max": context.requestedWindow.timeMax.toISOString(),
  "reconciliation.window.requested_time_min": context.requestedWindow.timeMin.toISOString(),
  ...(context.authoritativeWindow && {
    "reconciliation.window.authoritative_time_max": context.authoritativeWindow.timeMax.toISOString(),
    "reconciliation.window.authoritative_time_min": context.authoritativeWindow.timeMin.toISOString(),
  }),
});

interface DestinationAttemptTimings {
  attemptStartedAt: number;
  destinationLookupDurationMs: number;
  lockAcquireDurationMs: number;
  providerResolveDurationMs: number;
  readPoolWindow: DatabasePoolWindow;
  sourceAuthorityDurationMs: number;
}

const createDestinationAttemptWideEventFields = (
  timings: DestinationAttemptTimings,
): Record<string, number> => {
  const pool = timings.readPoolWindow();
  return {
    "database.pool.in_flight": pool.inFlight,
    "database.queries.count": pool.queryCount,
    "database.queries.duration_ms": pool.queryDurationMs,
    "database.queries.failed_count": pool.failedQueryCount,
    "database.queries.queued_count": pool.queuedQueryCount,
    "sync.attempt.duration_ms": roundDuration(performance.now() - timings.attemptStartedAt),
    "sync.phase.destination_lookup.duration_ms": timings.destinationLookupDurationMs,
    "sync.phase.lock_acquire.duration_ms": timings.lockAcquireDurationMs,
    "sync.phase.provider_resolve.duration_ms": timings.providerResolveDurationMs,
    "sync.phase.source_authority.duration_ms": timings.sourceAuthorityDurationMs,
  };
};

/*
 * Each targeted lookup is its own round trip, while the windowed list is one request
 * whatever it enumerates. Past this many mappings the round trips cost more than the
 * page they replace, so the read reverts to the single listing.
 */
const TARGETED_DESTINATION_READ_LIMIT = 25;

const DESTINATION_VERIFICATION_LIMIT = 200;

interface TargetedDestinationReadProvider {
  getRemoteEventsByIds?: (ids: string[]) => Promise<RemoteEvent[]>;
  listRemoteEvents: (options: ListRemoteEventsOptions) => Promise<RemoteEvent[]>;
  /**
   * Direct by-id existence check, independent of any time window. The windowed
   * listRemoteEvents pass below can miss an already-mapped event it should still find (e.g. a
   * recurring series whose own start/dateTime is its first, possibly long-past, occurrence) -
   * that must not read as "gone", or the mapping is deleted and re-created every cycle.
   */
  verifyEventsExist?: (targets: EventVerificationTarget[]) => Promise<EventPresence[] | RemoteEvent[]>;
}

interface DestinationRemoteReadContext {
  existingMappings: EventMapping[];
  localEvents: MaterializedSyncableEvent[];
  provider: TargetedDestinationReadProvider;
  requestedWindow: SyncWindow;
  /*
   * The position the previous cycle's verification pass stopped at, as persisted per destination.
   * Carrying the field - even holding null - is what enrolls a caller in rotation: the resume
   * position is only reported back to a caller that keeps one, since a caller that discards it
   * would advance nothing and only ever re-ask about the same prefix.
   */
  verificationCursor?: string | null;
}

interface DestinationRemoteRead {
  /*
   * Null means the read paged the window and so speaks for every mapping in it. A set
   * names the only mappings whose absence from remoteEvents is evidence of anything.
   */
  authoritativeMappingIds: ReadonlySet<string> | null;
  remoteEvents: RemoteEvent[];
  verification?: DestinationVerificationReport;
}

interface TargetedDestinationReadPlan {
  deleteIdentifiers: string[];
  mappingIds: Set<string>;
}

const planTargetedDestinationRead = (
  localEvents: MaterializedSyncableEvent[],
  existingMappings: EventMapping[],
): TargetedDestinationReadPlan => {
  const mappingsBySyncEventId = new Map<string, EventMapping[]>();
  for (const mapping of existingMappings) {
    const mappings = mappingsBySyncEventId.get(mapping.syncEventId) ?? [];
    mappings.push(mapping);
    mappingsBySyncEventId.set(mapping.syncEventId, mappings);
  }
  const deleteIdentifiers = new Set<string>();
  const mappingIds = new Set<string>();
  for (const localEvent of localEvents) {
    for (const mapping of mappingsBySyncEventId.get(localEvent.id) ?? []) {
      /* A mapping the destination calendar holds no event for has no identifier to read by, and
         asking anyway is a request for the whole mailbox rather than for one event. */
      if (!namesEventInDestination(mapping)) {
        continue;
      }
      deleteIdentifiers.add(mapping.deleteIdentifier);
      mappingIds.add(mapping.id);
    }
  }
  return { deleteIdentifiers: [...deleteIdentifiers], mappingIds };
};

/*
 * The by-id read speaks for exactly the identifiers it asked about, so one it did not return
 * is absent. It asks only about the mappings the push plan touches, and a mapping outside
 * that plan is never established either way: unknown, and left exactly as it is.
 */
const reportTargetedDestinationRead = (
  plan: TargetedDestinationReadPlan,
  existingMappings: EventMapping[],
  remoteEvents: RemoteEvent[],
): DestinationVerificationReport => {
  const askedDeleteIds = new Set(plan.deleteIdentifiers);
  const presentDeleteIds = new Set(
    remoteEvents
      .map((remoteEvent) => remoteEvent.deleteId)
      .filter((deleteId) => askedDeleteIds.has(deleteId)),
  );
  const unverifiedMappingIds = new Set(
    existingMappings
      .filter((mapping) => !plan.mappingIds.has(mapping.id))
      .map((mapping) => mapping.id),
  );
  return {
    /* The targeted read asks about the whole push plan, so it never leaves a position to resume. */
    unverifiedCount: unverifiedMappingIds.size,
    unverifiedMappingIds,
    verifiedAbsentCount: askedDeleteIds.size - presentDeleteIds.size,
    verifiedPresentCount: presentDeleteIds.size,
  };
};

/*
 * The windowed listing above is a best-effort, bounded discovery pass (used to find orphaned
 * keeper events not covered by any mapping) - it is not the source of truth for whether an
 * *already-mapped* event still exists. A mapping whose destination uid didn't turn up in that
 * pass gets one more, authoritative check before it is treated as gone: a direct by-id lookup,
 * for providers that expose one.
 */
/* A three-valued report confirms only what it calls present: an absence, or a read that could not
   tell, must never be dressed up as a live remote event. */
const toConfirmedRemoteEvents = (verified: EventPresence[] | RemoteEvent[]): RemoteEvent[] => {
  const confirmed: RemoteEvent[] = [];
  for (const entry of verified) {
    if (!("status" in entry)) {
      confirmed.push(entry);
      continue;
    }
    if (entry.status === "present" && entry.event) {
      confirmed.push(entry.event);
    }
  }
  return confirmed;
};

/*
 * Google and CalDAV answer three-valued and always speak for every identifier asked about.
 * Outlook answers with the events it found and throws when it cannot tell, so an identifier
 * it left out is a 404: absent. Reading an omission from a three-valued answer as absence
 * would invent evidence, so it stays unknown.
 */
const createDefaultPresence = (
  verified: EventPresence[] | RemoteEvent[],
): EventPresenceStatus => {
  if (verified.some((entry) => "status" in entry)) {
    return "unknown";
  }
  return "absent";
};

/* An answer that names where the mirror is but carries no event body cannot be matched back to its
   mapping, so it settles nothing: neither "present" nor "elsewhere" can be acted on without the
   object, and a verdict nothing can act on has to leave the mapping unverified rather than let the
   run walk past it as though the destination had been read. */
const readReportedPresence = (entry: EventPresence): EventPresenceStatus => {
  if ((entry.status === "present" || entry.status === "elsewhere") && !entry.event) {
    return "unknown";
  }
  return entry.status;
};

const readVerifiedPresence = (
  askedDeleteIds: string[],
  verified: EventPresence[] | RemoteEvent[],
): Map<string, EventPresenceStatus> => {
  const presence = new Map<string, EventPresenceStatus>(
    askedDeleteIds.map((deleteId) => [deleteId, createDefaultPresence(verified)]),
  );
  for (const entry of verified) {
    if ("status" in entry) {
      presence.set(entry.identifier, readReportedPresence(entry));
      continue;
    }
    presence.set(entry.deleteId, "present");
  }
  return presence;
};

interface VerifiedDestinationRead {
  remoteEvents: RemoteEvent[];
  verification?: DestinationVerificationReport;
}

const countVerifiedPresence = (
  presenceByDeleteId: ReadonlyMap<string, EventPresenceStatus>,
  status: EventPresenceStatus,
): number => [...presenceByDeleteId.values()].filter((value) => value === status).length;

/* A mirror found in another folder of the same mailbox was found: it is the customer's copy, alive,
   and the reconciliation repairs it in place rather than recreating it. Counting it anywhere near
   absent would say a live mirror is gone, and counting it nowhere at all is how it stayed invisible
   while the mapping froze -- so it is reported with the mirrors the read positively located. */
const countMirrorsTheReadLocated = (
  presenceByDeleteId: ReadonlyMap<string, EventPresenceStatus>,
): number =>
  countVerifiedPresence(presenceByDeleteId, "present")
  + countVerifiedPresence(presenceByDeleteId, "elsewhere");

/*
 * Everything past the budget is never asked about at all, so it joins the mappings the
 * provider could not settle: unknown, and left exactly as it is.
 */
const collectUnverifiedMappingIds = (
  budgetedMappings: EventMapping[],
  beyondBudgetMappings: EventMapping[],
  presenceByDeleteId: ReadonlyMap<string, EventPresenceStatus>,
): Set<string> => {
  const unverifiedMappingIds = new Set(beyondBudgetMappings.map((mapping) => mapping.id));
  for (const mapping of budgetedMappings) {
    if (presenceByDeleteId.get(mapping.deleteIdentifier) === "unknown") {
      unverifiedMappingIds.add(mapping.id);
    }
  }
  return unverifiedMappingIds;
};

/*
 * A population larger than one budget used to be sliced from the same lexicographic start every
 * cycle, so the tail was never asked about even once: a mirror the recipient deleted past that
 * prefix stayed unverified forever and was never restored. The order stays deterministic, but the
 * window now opens just after where the previous cycle stopped, so successive cycles walk the
 * whole set. A cycle is still capped at the budget, and for a given cursor it asks about exactly
 * the same mappings whatever order the rows arrived in.
 */
interface VerificationRotation {
  cursor: string | null;
}

/* Only a caller that carries the cursor between runs can advance it, so only that caller rotates. */
const readVerificationRotation = (
  context: DestinationRemoteReadContext,
): VerificationRotation | null => {
  if (!("verificationCursor" in context)) {
    return null;
  }
  return { cursor: context.verificationCursor ?? null };
};

const findVerificationRotationStart = (
  sortedMappings: EventMapping[],
  verificationCursor: string | null | undefined,
): number => {
  if (!verificationCursor) {
    return 0;
  }
  const resumeIndex = sortedMappings.findIndex((mapping) =>
    mapping.deleteIdentifier.localeCompare(verificationCursor) > 0);
  /* The cursor sits at or past the end - a mapping since removed, or the last one asked about. */
  if (resumeIndex === -1) {
    return 0;
  }
  return resumeIndex;
};

const selectBudgetedMappings = (
  sortedMappings: EventMapping[],
  rotationStart: number,
): EventMapping[] => {
  if (sortedMappings.length <= DESTINATION_VERIFICATION_LIMIT) {
    return sortedMappings;
  }
  /* A cycle that reaches the end of the set stops there rather than filling the remaining budget
     from the top: wrapping would re-ask identifiers this same rotation just covered and leave the
     resume position behind where it already was, so the walk stopped moving forward. The next
     cycle starts from the top on its own, because a cursor at the end resumes at index zero. */
  return sortedMappings.slice(rotationStart, rotationStart + DESTINATION_VERIFICATION_LIMIT);
};

/* Nothing was left out, so the next cycle starts from the top rather than resuming mid-set. */
const readNextVerificationCursor = (
  sortedMappings: EventMapping[],
  budgetedMappings: EventMapping[],
  rotation: VerificationRotation | null,
): { nextVerificationCursor?: string | null } => {
  if (!rotation) {
    return {};
  }
  const lastAsked = budgetedMappings.at(-1);
  if (budgetedMappings.length >= sortedMappings.length || !lastAsked) {
    return { nextVerificationCursor: null };
  }
  return { nextVerificationCursor: lastAsked.deleteIdentifier };
};

const withVerifiedUnconfirmedMappings = async (
  provider: TargetedDestinationReadProvider,
  existingMappings: EventMapping[],
  remoteEvents: RemoteEvent[],
  requestedWindow: SyncWindow,
  rotation: VerificationRotation | null,
): Promise<VerifiedDestinationRead> => {
  if (!provider.verifyEventsExist) {
    return { remoteEvents };
  }
  const remoteUids = new Set(remoteEvents.map((event) => event.uid));
  const unconfirmedMappings = existingMappings
    .filter((mapping) =>
      !remoteUids.has(mapping.destinationEventUid)
      /* Nothing to verify: the calendar this sync owns already answered that it holds no event for
         this mapping, and the copy the read found outside it is not this calendar's to act on. */
      && namesEventInDestination(mapping)
      && overlapsTimeWindow(mapping, requestedWindow.timeMin, requestedWindow.timeMax))
    .toSorted((first, second) =>
      first.deleteIdentifier.localeCompare(second.deleteIdentifier));
  const budgetedMappings = selectBudgetedMappings(
    unconfirmedMappings,
    findVerificationRotationStart(unconfirmedMappings, rotation?.cursor),
  );
  const budgetedMappingIds = new Set(budgetedMappings.map((mapping) => mapping.id));
  const beyondBudgetMappings = unconfirmedMappings
    .filter((mapping) => !budgetedMappingIds.has(mapping.id));
  if (budgetedMappings.length === 0) {
    return { remoteEvents };
  }
  const askedDeleteIds = budgetedMappings.map((mapping) => mapping.deleteIdentifier);
  /* Outlook can only tell a re-keyed mirror from a deleted one with the uid the mapping carries. */
  const verified = await provider.verifyEventsExist(budgetedMappings.map((mapping) => ({
    deleteId: mapping.deleteIdentifier,
    uid: mapping.destinationEventUid,
  })));
  const presenceByDeleteId = readVerifiedPresence(askedDeleteIds, verified);
  const unverifiedMappingIds = collectUnverifiedMappingIds(
    budgetedMappings,
    beyondBudgetMappings,
    presenceByDeleteId,
  );
  return {
    remoteEvents: [...remoteEvents, ...toConfirmedRemoteEvents(verified)],
    verification: {
      ...readNextVerificationCursor(unconfirmedMappings, budgetedMappings, rotation),
      unverifiedCount: unverifiedMappingIds.size,
      unverifiedMappingIds,
      verifiedAbsentCount: countVerifiedPresence(presenceByDeleteId, "absent"),
      verifiedPresentCount: countMirrorsTheReadLocated(presenceByDeleteId),
    },
  };
};

const readDestinationRemoteEvents = async (
  context: DestinationRemoteReadContext,
): Promise<DestinationRemoteRead> => {
  const plan = planTargetedDestinationRead(context.localEvents, context.existingMappings);
  const { getRemoteEventsByIds: lookUpByIds } = context.provider;
  /*
   * A provider without the lookup, or a change set too large for one to be cheaper than a
   * single page, keeps the windowed listing and its full authority.
   */
  if (!lookUpByIds || plan.deleteIdentifiers.length > TARGETED_DESTINATION_READ_LIMIT) {
    const remoteEvents = await context.provider.listRemoteEvents({
      timeMax: context.requestedWindow.timeMax,
      timeMin: context.requestedWindow.timeMin,
    });
    const verified = await withVerifiedUnconfirmedMappings(
      context.provider,
      context.existingMappings,
      remoteEvents,
      context.requestedWindow,
      readVerificationRotation(context),
    );
    return { authoritativeMappingIds: null, ...verified };
  }
  const remoteEvents = await lookUpByIds(plan.deleteIdentifiers);
  return {
    authoritativeMappingIds: plan.mappingIds,
    remoteEvents,
    verification: reportTargetedDestinationRead(plan, context.existingMappings, remoteEvents),
  };
};

const readDestinationReconciliationState = async (
  readRemoteEvents: (localState: DestinationLocalState) => Promise<RemoteEvent[]>,
  readLocalState: () => Promise<DestinationLocalState>,
): Promise<DestinationLocalState & { remoteEvents: RemoteEvent[] }> => {
  const localState = await readLocalState();
  const remoteEvents = await readRemoteEvents(localState);
  return { ...localState, remoteEvents };
};

interface CalendarSyncCompletion {
  provider: string;
  accountId: string;
  calendarId: string;
  userId: string;
  added: number;
  addFailed: number;
  /* Edits delivered to mirrors the mapping already named. Reported apart from `added` because a
     healthy in-place update never creates anything, so without this number a run that pushed a
     hundred edits is byte-identical to one that pushed none. */
  updated: number;
  removed: number;
  removeFailed: number;
  conflictsResolved: number;
  errors: string[];
  durationMs: number;
  syncEvent?: Record<string, unknown>;
}

interface CalendarSyncFailure {
  provider: string;
  accountId: string;
  calendarId: string;
  userId: string;
  error: unknown;
  durationMs: number;
  backoffApplied: boolean;
  syncEvent?: Record<string, unknown>;
}

/*
 * A destination attempt that returns before onCalendarComplete emits a wide event with no
 * counts on it at all, which reads identically whether it mirrored nothing because there
 * was nothing to mirror or because it never got far enough to look. Each way out says so.
 */
const DESTINATION_SKIP_REASONS = [
  "destination_not_pushable",
  "lock_not_acquired",
  "destination_ineligible",
  "provider_unresolved",
] as const;

type DestinationSkipReason = (typeof DESTINATION_SKIP_REASONS)[number];

interface DestinationSyncSkip {
  calendarId: string;
  mappedSourceCount: number;
  reason: DestinationSkipReason;
}

interface SyncCallbacks {
  onSyncEvent?: (event: Record<string, unknown>) => void;
  onProgress?: (update: SyncProgressUpdate) => void;
  onCalendarComplete?: (completion: CalendarSyncCompletion) => void;
  onCalendarError?: (failure: CalendarSyncFailure) => void;
  onCalendarSkipped?: (skip: DestinationSyncSkip) => void;
}

interface DestinationAttempt {
  accountId: string;
  calendarId: string;
  failureCount: number;
  nextAttemptAt: Date | null;
  provider: string;
  syncFutureRange: string;
  syncHistoricRange: string;
  userId: string;
  verificationCursor: string | null;
}

const getDestinationAttempt = async (
  database: BunSQLDatabase,
  userId: string,
  calendarId: string,
): Promise<DestinationAttempt | null> => {
  const [destination] = await database
    .select({
      accountId: calendarsTable.accountId,
      calendarId: calendarsTable.id,
      failureCount: calendarsTable.failureCount,
      nextAttemptAt: calendarsTable.nextAttemptAt,
      provider: calendarAccountsTable.provider,
      syncFutureRange: calendarsTable.syncFutureRange,
      syncHistoricRange: calendarsTable.syncHistoricRange,
      userId: calendarsTable.userId,
      verificationCursor: calendarsTable.verificationCursor,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(and(
      eq(calendarsTable.userId, userId),
      eq(calendarsTable.id, calendarId),
      eq(calendarsTable.disabled, false),
      arrayContains(calendarsTable.capabilities, ["push"]),
    ))
    .limit(1);
  return destination ?? null;
};

const isDestinationAttemptEligible = (
  destination: DestinationAttempt,
  now: Date = new Date(),
): boolean =>
  destination.nextAttemptAt === null || destination.nextAttemptAt <= now;

// The verdict records whether this fired rather than re-reading the clock: a run that found nothing to do and a run truncated at the gate both return all zeros.
const isDestinationAttemptSuperseded = (
  config: SyncConfig,
  sourceCalendarsChanged: boolean,
): boolean => {
  if (sourceCalendarsChanged) {
    return true;
  }
  if (config.abortSignal?.aborted === true) {
    return true;
  }
  if (!config.deadlineMs) {
    return false;
  }
  return Date.now() >= config.deadlineMs;
};

const resetDestinationBackoffIfNeeded = async (
  database: BunSQLDatabase,
  destination: DestinationAttempt,
): Promise<void> => {
  if (destination.failureCount > 0) {
    await resetDestinationBackoff(database, destination.calendarId);
  }
};

/*
 * The pass has already spent its round trips by the time this runs, so the cursor advances even if
 * the attempt is superseded later: a destination that keeps being cut short would otherwise re-ask
 * about the same prefix forever, which is the starvation the rotation exists to end.
 */
/*
 * A report that carries no cursor field is the by-id read saying it has no opinion on the rotation,
 * which is not the same as an explicit null asking the next cycle to start from the top. Handing
 * back a wrapper keeps the two apart at the persistence seam, where reading the bare field would
 * collapse "no opinion" into "start from the top" and discard the position a windowed cycle paid
 * round trips for.
 */
interface ReportedVerificationCursor {
  value: string | null;
}

const readReportedVerificationCursor = (
  report: DestinationVerificationReport,
): ReportedVerificationCursor | null => {
  if (!("nextVerificationCursor" in report)) {
    return null;
  }
  const reported = report.nextVerificationCursor;
  if (reported === globalThis.undefined) {
    return null;
  }
  return { value: reported };
};

const persistDestinationVerificationCursor = async (
  database: BunSQLDatabase,
  destination: DestinationAttempt,
  nextVerificationCursor: string | null,
): Promise<void> => {
  if (nextVerificationCursor === destination.verificationCursor) {
    return;
  }
  await database
    .update(calendarsTable)
    .set({ verificationCursor: nextVerificationCursor })
    .where(eq(calendarsTable.id, destination.calendarId));
};

const hasSameRetryState = (
  observed: DestinationAttempt,
  current: DestinationAttempt | null,
): boolean =>
  current !== null
  && current.failureCount === observed.failureCount
  && (current.nextAttemptAt?.getTime() ?? null) === (observed.nextAttemptAt?.getTime() ?? null);

const escalateDestinationBackoff = async (
  database: BunSQLDatabase,
  destination: DestinationAttempt,
): Promise<void> => {
  const current = await getDestinationAttempt(
    database,
    destination.userId,
    destination.calendarId,
  );
  if (!hasSameRetryState(destination, current)) {
    return;
  }
  await applyDestinationBackoff(database, destination);
};

const applyDestinationAttemptVerdict = async (
  options: {
    database: BunSQLDatabase;
    destination: DestinationAttempt;
    handle: SyncLockHandle;
    verdict: DestinationAttemptVerdict;
  },
): Promise<boolean> => {
  const { database, destination, handle, verdict } = options;
  if (!await handle.isCurrent()) {
    return false;
  }
  if (verdict === "failed") {
    await escalateDestinationBackoff(database, destination);
  } else if (verdict === "succeeded") {
    await resetDestinationBackoffIfNeeded(database, destination);
  }
  return true;
};

const recordDestinationAttemptFailure = async (
  options: {
    callbacks?: SyncCallbacks;
    database: BunSQLDatabase;
    destination: DestinationAttempt;
    durationMs: number;
    error: unknown;
    handle: SyncLockHandle;
    syncEvent: Record<string, unknown> | null;
  },
): Promise<string[]> => {
  const { callbacks, database, destination, durationMs, error, handle, syncEvent } = options;
  const verdict = resolveThrownDestinationVerdict(error);
  const stillOwned = await applyDestinationAttemptVerdict({
    database,
    destination,
    handle,
    verdict,
  });

  callbacks?.onCalendarError?.({
    provider: destination.provider,
    accountId: destination.accountId,
    calendarId: destination.calendarId,
    userId: destination.userId,
    error,
    durationMs,
    backoffApplied: stillOwned && verdict === "failed",
    ...(syncEvent && { syncEvent }),
  });
  return [getErrorMessage(error)];
};

const countMappedSources = async (
  database: Pick<BunSQLDatabase, "select">,
  destinationCalendarId: string,
): Promise<number> => {
  const mappings = await database
    .select({ sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId));

  return mappings.length;
};

const syncDestinationsForUser = async (
  userId: string,
  config: SyncConfig,
  callbacks?: SyncCallbacks,
): Promise<SyncDestinationsResult> => {
  const { database, redis } = config;

  const destinations = await database
    .select({
      calendarId: calendarsTable.id,
    })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.id, config.destinationCalendarId),
        eq(calendarsTable.disabled, false),
        arrayContains(calendarsTable.capabilities, ["push"]),
      ),
    );

  const mappedSourceCount = await countMappedSources(database, config.destinationCalendarId);

  const reportSkip = (calendarId: string, reason: DestinationSkipReason): void => {
    callbacks?.onCalendarSkipped?.({ calendarId, mappedSourceCount, reason });
  };

  if (destinations.length === 0) {
    reportSkip(config.destinationCalendarId, "destination_not_pushable");
    return EMPTY_RESULT;
  }

  const syncLock = createSyncLock(redis, "background");

  let added = 0;
  let addFailed = 0;
  let removed = 0;
  let removeFailed = 0;
  const errors: string[] = [];
  const syncEvents: Record<string, unknown>[] = [];

  const runDestinationAttempt = async (
    destinationCandidate: (typeof destinations)[number],
  ): Promise<void> => {
    await withDatabasePoolWindow(async (readPoolWindow): Promise<void> => {
      const attemptStartedAt = performance.now();
      const lockAcquire = await measurePhase(() => syncLock.acquire(
        destinationCandidate.calendarId,
        config.abortSignal,
        createMappingMutationLockId(userId),
      ));
      const lockResult = lockAcquire.value;
      if (!lockResult.acquired) {
        reportSkip(destinationCandidate.calendarId, "lock_not_acquired");
        return;
      }

      const { handle } = lockResult;
      const calendarAttempt: {
        superseded: boolean;
        syncEvent: Record<string, unknown> | null;
      } = { superseded: false, syncEvent: null };
      let attemptedDestination: DestinationAttempt | null = null;

      try {
        const destinationLookup = await measurePhase(() => getDestinationAttempt(
          database,
          userId,
          destinationCandidate.calendarId,
        ));
        const currentDestination = destinationLookup.value;
        if (!currentDestination || !isDestinationAttemptEligible(currentDestination)) {
          reportSkip(destinationCandidate.calendarId, "destination_ineligible");
          return;
        }
        const destination = currentDestination;
        attemptedDestination = destination;

        const providerResolve = await measurePhase(() => resolveSyncProvider({
          database,
          provider: destination.provider,
          calendarId: destination.calendarId,
          userId: destination.userId,
          accountId: destination.accountId,
          oauthConfig: config.oauthConfig,
          encryptionKey: config.encryptionKey,
          refreshLockStore: config.refreshLockStore,
          safeFetchOptions: config.safeFetchOptions,
          rateLimiter: createProviderRateLimiter(redis, userId, destination.provider),
          signal: config.abortSignal,
        }));
        const syncProvider = providerResolve.value;

        if (!syncProvider) {
          reportSkip(destinationCandidate.calendarId, "provider_unresolved");
          return;
        }

        const providerRef = syncProvider;

        const sourceAuthorityStartedAt = performance.now();
        const sourceCalendarIds = await getMappedSourceCalendarIds(
          database,
          destination.calendarId,
        );
        /*
         * The stored ranges are the window, with no plan clamp applied here. Only a Pro
         * account can store a non-default range, so clamping at sync time adds no
         * enforcement — it only retroactively shrinks an already-synced window, and a
         * transient non-active subscription status would delete that history remotely.
         */
        const requestedWindow = getConfigurableSyncWindow(
          syncRangeSchema.assert(destination.syncHistoricRange),
          syncRangeSchema.assert(destination.syncFutureRange),
        );
        const initialSourceAuthority = await resolveSourceAuthority(
          database,
          sourceCalendarIds,
          requestedWindow,
        );
        const sourceAuthorityDurationMs = roundDuration(performance.now() - sourceAuthorityStartedAt);
        let authoritativeSourceWindows = initialSourceAuthority.sourceWindows;
        let authoritativeWindow = initialSourceAuthority.aggregateWindow;
        let eventReadDiagnostics: DestinationEventReadDiagnostics = {
          candidateEventStateCount: 0,
          emptyTimeRangeCount: 0,
          excludedBySyncPolicyCount: 0,
          invertedTimeRangeCount: 0,
          materializedEventCount: 0,
          missingSourceEventUidCount: 0,
          overBudgetSourceEventStateIds: [],
          overBudgetSourceEventUids: [],
          outsideReconciliationWindowCount: 0,
          syncableEventCount: 0,
        };
        let localReadDurationMs = 0;
        let remoteReadDurationMs = 0;
        let sourceCalendarIdsAtLocalRead = sourceCalendarIds;
        let sourceCalendarsChangedDuringRemoteRead = false;
        let authoritativeMappingIds: ReadonlySet<string> | null = null;
        let verification: DestinationVerificationReport | null = null;
        let unverifiedMappingIds: ReadonlySet<string> = new Set<string>();
        const reconciliationState = await readDestinationReconciliationState(
          async (localState) => {
            const startedAt = performance.now();
            try {
              const read = await readDestinationRemoteEvents({
                existingMappings: localState.existingMappings,
                localEvents: localState.localEvents,
                provider: providerRef,
                requestedWindow,
                verificationCursor: destination.verificationCursor,
              });
              ({ authoritativeMappingIds } = read);
              verification = read.verification ?? null;
              unverifiedMappingIds = verification?.unverifiedMappingIds ?? new Set<string>();
              const reportedCursor = read.verification
                && readReportedVerificationCursor(read.verification);
              if (reportedCursor) {
                await persistDestinationVerificationCursor(
                  database,
                  destination,
                  reportedCursor.value,
                );
              }
              return read.remoteEvents;
            } finally {
              remoteReadDurationMs = roundDuration(performance.now() - startedAt);
            }
          },
          async () => {
            const startedAt = performance.now();
            try {
              return await withSourceIngestLocks(
                database,
                sourceCalendarIds,
                async (lockedDatabase) => {
                  sourceCalendarIdsAtLocalRead = await getMappedSourceCalendarIds(
                    lockedDatabase,
                    destination.calendarId,
                  );
                  sourceCalendarsChangedDuringRemoteRead = haveSourceCalendarsChanged(
                    sourceCalendarIds,
                    sourceCalendarIdsAtLocalRead,
                  );
                  if (sourceCalendarsChangedDuringRemoteRead) {
                    /*
                     * The replacement set is not covered by the locks acquired
                     * above. Supersede this run rather than reading an unlocked
                     * source snapshot or acquiring nested locks out of order.
                     */
                    authoritativeWindow = null;
                    authoritativeSourceWindows = new Map();
                    return { existingMappings: [], localEvents: [] };
                  }
                  /*
                   * Source coverage can shrink while the destination provider is
                   * being read. Re-read it under the source ingest locks and only
                   * narrow the original window. Expansions wait for the next run,
                   * because the remote read may not include the newly authoritative
                   * history yet.
                   */
                  const currentSourceAuthority = await resolveSourceAuthority(
                    lockedDatabase,
                    sourceCalendarIdsAtLocalRead,
                    requestedWindow,
                  );
                  authoritativeSourceWindows = narrowSourceAuthority(
                    initialSourceAuthority.sourceWindows,
                    currentSourceAuthority.sourceWindows,
                  );
                  authoritativeWindow = createAggregateAuthorityWindow(
                    sourceCalendarIdsAtLocalRead,
                    authoritativeSourceWindows,
                    requestedWindow,
                  );
                  const localEvents: MaterializedSyncableEvent[] = [];
                  const localReadWindow = getBoundingSourceAuthorityWindow(
                    authoritativeSourceWindows,
                  );
                  if (localReadWindow) {
                    const eventRead = await getEventsForCalendarsWithDiagnostics(
                      lockedDatabase,
                      [...authoritativeSourceWindows.keys()],
                      localReadWindow,
                    );
                    eventReadDiagnostics = eventRead.diagnostics;
                    localEvents.push(...eventRead.events);
                  }
                  return {
                    localEvents,
                    existingMappings: await getEventMappingsForDestination(
                      lockedDatabase,
                      destination.calendarId,
                    ),
                  };
                },
              );
            } finally {
              localReadDurationMs = roundDuration(performance.now() - startedAt);
            }
          },
        );
        const reconciliationWideEventFields = createDestinationReconciliationWideEventFields({
          authoritativeWindow,
          eventReadDiagnostics,
          localReadDurationMs,
          requestedWindow,
          remoteReadDurationMs,
          sourceCalendarIdsAtLocalRead,
          sourceCalendarIdsBeforeRemoteRead: sourceCalendarIds,
          verification,
          verifiedSourceCalendarCount: authoritativeSourceWindows.size,
        });
        const isAttemptCurrent = (): Promise<boolean> => {
          if (isDestinationAttemptSuperseded(config, sourceCalendarsChangedDuringRemoteRead)) {
            calendarAttempt.superseded = true;
            return Promise.resolve(false);
          }
          return handle.isCurrent();
        };
        const result = await syncCalendar({
          userId: destination.userId,
          calendarId: destination.calendarId,
          provider: providerRef,
          readState: () => Promise.resolve(reconciliationState),
          isCurrent: isAttemptCurrent,
          flush: createDatabaseFlush(database),
          onProgress: callbacks?.onProgress,
          onSyncEvent: (event) => {
            const enrichedEvent = {
              ...event,
              ...reconciliationWideEventFields,
              ...createDestinationAttemptWideEventFields({
                attemptStartedAt,
                destinationLookupDurationMs: destinationLookup.durationMs,
                lockAcquireDurationMs: lockAcquire.durationMs,
                providerResolveDurationMs: providerResolve.durationMs,
                readPoolWindow,
                sourceAuthorityDurationMs,
              }),
              "provider.name": destination.provider,
              "provider.account_id": destination.accountId,
              "provider.calendar_id": destination.calendarId,
              "user.id": destination.userId,
            };
            calendarAttempt.syncEvent = enrichedEvent;
            syncEvents.push(enrichedEvent);
            if (callbacks?.onSyncEvent) {
              callbacks.onSyncEvent(enrichedEvent);
            }
          },
          reconciliationScope: createDestinationReconciliationScope({
            authoritativeMappingIds,
            authoritativeSourceWindows,
            authoritativeWindow,
            eventReadDiagnostics,
            requestedWindow,
            sourceCalendarIdsAtLocalRead,
            unverifiedMappingIds,
          }),
        });

        callbacks?.onCalendarComplete?.({
          provider: destination.provider,
          accountId: destination.accountId,
          calendarId: destination.calendarId,
          userId: destination.userId,
          added: result.added,
          addFailed: result.addFailed,
          updated: result.updated,
          removed: result.removed,
          removeFailed: result.removeFailed,
          conflictsResolved: result.conflictsResolved,
          errors: result.errors,
          durationMs: extractNumericField(calendarAttempt.syncEvent, "duration_ms"),
          ...(calendarAttempt.syncEvent && { syncEvent: calendarAttempt.syncEvent }),
        });

        const stillOwned = await applyDestinationAttemptVerdict({
          database,
          destination,
          handle,
          verdict: resolveDestinationAttemptVerdict(result, calendarAttempt.superseded),
        });
        if (!stillOwned) {
          return;
        }

        added += result.added;
        addFailed += result.addFailed;
        removed += result.removed;
        removeFailed += result.removeFailed;
        errors.push(...result.errors);
      } catch (error) {
        const destination = attemptedDestination;
        if (!destination) {
          throw error;
        }

        errors.push(...await recordDestinationAttemptFailure({
          callbacks,
          database,
          destination,
          durationMs: extractNumericField(calendarAttempt.syncEvent, "duration_ms"),
          error,
          handle,
          syncEvent: calendarAttempt.syncEvent,
        }));
      } finally {
        await handle.release();
      }
    });
  };

  for (const destinationCandidate of destinations) {
    if (config.abortSignal?.aborted) {
      break;
    }

    await runDestinationAttempt(destinationCandidate);
  }

  return { added, addFailed, removed, removeFailed, errors, syncEvents };
};

export {
  createAggregateAuthorityWindow,
  createDestinationAttemptWideEventFields,
  createDestinationReconciliationScope,
  createDestinationReconciliationWideEventFields,
  OVER_BUDGET_SERIES_UID_SAMPLE_SIZE,
  TARGETED_DESTINATION_READ_LIMIT,
  readDestinationReconciliationState,
  readDestinationRemoteEvents,
  resolveSourceAuthority,
  resolveStoredSourceCoverage,
  syncDestinationsForUser,
};
export type {
  CalendarSyncCompletion,
  CalendarSyncFailure,
  DestinationSkipReason,
  DestinationSyncSkip,
  SyncConfig,
  SyncDestinationsResult,
};
