import { describe, expect, it, vi } from "vitest";
import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";
import { computeSyncOperations } from "@keeper.sh/calendar";
import type { EventMapping } from "@keeper.sh/calendar";
import {
  createAggregateAuthorityWindow,
  createDestinationAttemptWideEventFields,
  createDestinationReconciliationScope,
  createDestinationReconciliationWideEventFields,
  OVER_BUDGET_SERIES_UID_SAMPLE_SIZE,
  readDestinationReconciliationState,
  resolveSourceAuthority,
  resolveStoredSourceCoverage,
} from "../src/sync-user";

const COMPLETE_SOURCE_COVERAGE = {
  ingestFutureRange: "2_years",
  ingestHistoricRange: "1_week",
  ingestWindowEnd: new Date("2028-01-01T00:00:00.000Z"),
  ingestWindowRecordedAt: new Date("2026-01-01T00:00:00.000Z"),
  ingestWindowStart: new Date("2025-12-25T00:00:00.000Z"),
};

describe("resolveStoredSourceCoverage", () => {
  it("returns a verified window for a complete, valid coverage record", () => {
    expect(resolveStoredSourceCoverage(COMPLETE_SOURCE_COVERAGE)).toEqual({
      timeMax: COMPLETE_SOURCE_COVERAGE.ingestWindowEnd,
      timeMin: COMPLETE_SOURCE_COVERAGE.ingestWindowStart,
    });
  });

  it.each([
    "ingestWindowStart",
    "ingestWindowEnd",
    "ingestWindowRecordedAt",
  ] as const)("rejects coverage with missing %s", (field) => {
    expect(resolveStoredSourceCoverage({
      ...COMPLETE_SOURCE_COVERAGE,
      [field]: null,
    })).toBeNull();
  });

  it("rejects invalid range labels and invalid window ordering", () => {
    expect(resolveStoredSourceCoverage({
      ...COMPLETE_SOURCE_COVERAGE,
      ingestHistoricRange: "unknown",
    })).toBeNull();
    expect(resolveStoredSourceCoverage({
      ...COMPLETE_SOURCE_COVERAGE,
      ingestWindowStart: COMPLETE_SOURCE_COVERAGE.ingestWindowEnd,
    })).toBeNull();
  });
});

describe("readDestinationReconciliationState", () => {
  it("finishes remote I/O before entering the local snapshot transaction", async () => {
    const order: string[] = [];

    const state = await readDestinationReconciliationState(
      () => {
        order.push("remote");
        return Promise.resolve([]);
      },
      () => {
        order.push("local-transaction");
        return Promise.resolve({ existingMappings: [], localEvents: [] });
      },
    );

    expect(order).toEqual(["remote", "local-transaction"]);
    expect(state).toEqual({ existingMappings: [], localEvents: [], remoteEvents: [] });
  });

  it("does not open a local transaction when the remote read fails", async () => {
    const readLocalState = vi.fn(() => Promise.resolve({
      existingMappings: [],
      localEvents: [],
    }));

    await expect(readDestinationReconciliationState(
      () => Promise.reject(new Error("remote read failed")),
      readLocalState,
    )).rejects.toThrow("remote read failed");

    expect(readLocalState).not.toHaveBeenCalled();
  });
});

describe("createDestinationAttemptWideEventFields", () => {
  const POOL_SAMPLE = {
    failedQueryCount: 1,
    inFlight: 4,
    queryCount: 17,
    queryDurationMs: 63.5,
    queuedQueryCount: 3,
  };

  it("reports a total that covers every phase leading up to the reconcile", () => {
    const fields = createDestinationAttemptWideEventFields({
      attemptStartedAt: performance.now() - 500,
      destinationLookupDurationMs: 4.5,
      lockAcquireDurationMs: 2.25,
      providerResolveDurationMs: 31,
      readPoolWindow: () => POOL_SAMPLE,
      sourceAuthorityDurationMs: 12,
    });

    expect(fields["sync.attempt.duration_ms"]).toBeGreaterThanOrEqual(500);
    expect(fields["sync.phase.lock_acquire.duration_ms"]).toBe(2.25);
    expect(fields["sync.phase.destination_lookup.duration_ms"]).toBe(4.5);
    expect(fields["sync.phase.provider_resolve.duration_ms"]).toBe(31);
    expect(fields["sync.phase.source_authority.duration_ms"]).toBe(12);
  });

  it("carries the database pool sample read at emit time", () => {
    const fields = createDestinationAttemptWideEventFields({
      attemptStartedAt: performance.now(),
      destinationLookupDurationMs: 0,
      lockAcquireDurationMs: 0,
      providerResolveDurationMs: 0,
      readPoolWindow: () => POOL_SAMPLE,
      sourceAuthorityDurationMs: 0,
    });

    expect(fields["database.pool.in_flight"]).toBe(4);
    expect(fields["database.queries.count"]).toBe(17);
    expect(fields["database.queries.duration_ms"]).toBe(63.5);
    expect(fields["database.queries.queued_count"]).toBe(3);
    expect(fields["database.queries.failed_count"]).toBe(1);
  });
});

describe("createDestinationReconciliationWideEventFields", () => {
  const eventReadDiagnostics = {
    candidateEventStateCount: 8,
    emptyTimeRangeCount: 1,
    excludedBySyncPolicyCount: 2,
    invertedTimeRangeCount: 0,
    materializedEventCount: 5,
    missingSourceEventUidCount: 1,
    outsideReconciliationWindowCount: 1,
    overBudgetSourceEventStateIds: [],
    overBudgetSourceEventUids: ["pathological-series"],
    syncableEventCount: 4,
  };

  it("records each stage that can reduce the local destination snapshot to zero", () => {
    expect(createDestinationReconciliationWideEventFields({
      eventReadDiagnostics,
      localReadDurationMs: 12.5,
      authoritativeWindow: {
        timeMax: new Date("2028-07-18T00:00:00.000Z"),
        timeMin: new Date("2026-07-11T00:00:00.000Z"),
      },
      requestedWindow: {
        timeMax: new Date("2028-07-18T00:00:00.000Z"),
        timeMin: new Date("2026-07-11T00:00:00.000Z"),
      },
      remoteReadDurationMs: 42.25,
      sourceCalendarIdsAtLocalRead: ["source-1", "source-2"],
      sourceCalendarIdsBeforeRemoteRead: ["source-1", "source-2"],
      verifiedSourceCalendarCount: 2,
    })).toEqual({
      "local_event_states.candidate_count": 8,
      "local_event_states.empty_time_range_count": 1,
      "local_event_states.excluded_by_sync_policy_count": 2,
      "local_event_states.inverted_time_range_count": 0,
      "local_event_states.materialized_count": 5,
      "local_event_states.missing_source_event_uid_count": 1,
      "local_event_states.outside_reconciliation_window_count": 1,
      "local_event_states.over_budget_series_count": 1,
      "local_event_states.over_budget_series_uids": "pathological-series",
      "local_event_states.syncable_count": 4,
      "reconciliation.local_read.duration_ms": 12.5,
      "reconciliation.remote_read.duration_ms": 42.25,
      "reconciliation.source_calendars.at_local_read_count": 2,
      "reconciliation.authority.verified": true,
      "reconciliation.source_calendars.before_remote_read_count": 2,
      "reconciliation.source_calendars.verified_count": 2,
      "reconciliation.source_calendars.changed_during_remote_read": false,
      "reconciliation.window.authoritative_time_max": "2028-07-18T00:00:00.000Z",
      "reconciliation.window.authoritative_time_min": "2026-07-11T00:00:00.000Z",
      "reconciliation.window.requested_time_max": "2028-07-18T00:00:00.000Z",
      "reconciliation.window.requested_time_min": "2026-07-11T00:00:00.000Z",
    });
  });

  it("caps the over-budget series UID list while still reporting the uncapped count", () => {
    const overBudgetCount = 40;
    const fields = createDestinationReconciliationWideEventFields({
      eventReadDiagnostics: {
        ...eventReadDiagnostics,
        overBudgetSourceEventUids: Array.from(
          { length: overBudgetCount },
          (_unused, index) => `pathological-series-${index}`,
        ),
      },
      localReadDurationMs: 1,
      authoritativeWindow: null,
      requestedWindow: {
        timeMax: new Date("2028-07-18T00:00:00.000Z"),
        timeMin: new Date("2026-07-11T00:00:00.000Z"),
      },
      remoteReadDurationMs: 2,
      sourceCalendarIdsAtLocalRead: ["source-1"],
      sourceCalendarIdsBeforeRemoteRead: ["source-1"],
      verifiedSourceCalendarCount: 1,
    });

    expect(overBudgetCount).toBeGreaterThan(OVER_BUDGET_SERIES_UID_SAMPLE_SIZE);

    const uids = String(fields["local_event_states.over_budget_series_uids"]).split(",");
    expect(uids).toHaveLength(OVER_BUDGET_SERIES_UID_SAMPLE_SIZE);
    expect(uids.at(-1)).toBe(`pathological-series-${OVER_BUDGET_SERIES_UID_SAMPLE_SIZE - 1}`);
    expect(fields["local_event_states.over_budget_series_count"]).toBe(overBudgetCount);
  });

  it("detects a same-sized source mapping replacement without depending on query order", () => {
    const reordered = createDestinationReconciliationWideEventFields({
      eventReadDiagnostics,
      localReadDurationMs: 1,
      authoritativeWindow: {
        timeMax: new Date("2028-07-18T00:00:00.000Z"),
        timeMin: new Date("2026-07-11T00:00:00.000Z"),
      },
      requestedWindow: {
        timeMax: new Date("2028-07-18T00:00:00.000Z"),
        timeMin: new Date("2026-07-11T00:00:00.000Z"),
      },
      remoteReadDurationMs: 2,
      sourceCalendarIdsAtLocalRead: ["source-2", "source-1"],
      sourceCalendarIdsBeforeRemoteRead: ["source-1", "source-2"],
      verifiedSourceCalendarCount: 2,
    });
    const replaced = createDestinationReconciliationWideEventFields({
      eventReadDiagnostics,
      localReadDurationMs: 1,
      authoritativeWindow: {
        timeMax: new Date("2028-07-18T00:00:00.000Z"),
        timeMin: new Date("2026-07-11T00:00:00.000Z"),
      },
      requestedWindow: {
        timeMax: new Date("2028-07-18T00:00:00.000Z"),
        timeMin: new Date("2026-07-11T00:00:00.000Z"),
      },
      remoteReadDurationMs: 2,
      sourceCalendarIdsAtLocalRead: ["source-1", "source-3"],
      sourceCalendarIdsBeforeRemoteRead: ["source-1", "source-2"],
      verifiedSourceCalendarCount: 2,
    });

    expect(reordered["reconciliation.source_calendars.changed_during_remote_read"]).toBe(false);
    expect(replaced["reconciliation.source_calendars.changed_during_remote_read"]).toBe(true);
  });
});

describe("createDestinationReconciliationScope", () => {
  const SOURCE_CALENDAR_ID = "source-1";
  const WINDOW = {
    timeMax: new Date("2028-01-01T00:00:00.000Z"),
    timeMin: new Date("2026-01-01T00:00:00.000Z"),
  };

  const baseDiagnostics = {
    candidateEventStateCount: 3,
    emptyTimeRangeCount: 0,
    excludedBySyncPolicyCount: 0,
    invertedTimeRangeCount: 0,
    materializedEventCount: 0,
    missingSourceEventUidCount: 0,
    outsideReconciliationWindowCount: 0,
    overBudgetSourceEventStateIds: [] as string[],
    overBudgetSourceEventUids: [] as string[],
    syncableEventCount: 0,
  };

  const createScope = (overBudgetSourceEventStateIds: string[]) =>
    createDestinationReconciliationScope({
      authoritativeSourceWindows: new Map([[SOURCE_CALENDAR_ID, WINDOW]]),
      authoritativeWindow: WINDOW,
      eventReadDiagnostics: { ...baseDiagnostics, overBudgetSourceEventStateIds },
      requestedWindow: WINDOW,
      sourceCalendarIdsAtLocalRead: [SOURCE_CALENDAR_ID],
    });

  const occurrenceMappings: EventMapping[] = [1, 2, 3].map((index) => ({
    calendarId: "destination-1",
    deleteIdentifier: `delete-identifier-${index}`,
    destinationEventUid: `destination-uid-${index}`,
    endTime: new Date(`2026-03-0${index}T15:00:00.000Z`),
    eventStateId: "over-budget-series",
    id: `over-budget-mapping-${index}`,
    sourceCalendarId: SOURCE_CALENDAR_ID,
    startTime: new Date(`2026-03-0${index}T14:00:00.000Z`),
    syncEventHash: `hash-${index}`,
    syncEventId: `over-budget-series::occurrence-${index}`,
  }));

  it("withholds an over-budget series from removal when its state ids are threaded through", () => {
    const scope = createScope(["over-budget-series"]);

    expect(scope.withheldSourceEventStateIds).toEqual(new Set(["over-budget-series"]));
    expect(computeSyncOperations([], occurrenceMappings, [], scope).operations).toEqual([]);
  });

  it("removes the same mirrors when the series was never withheld", () => {
    const scope = createScope([]);

    expect(computeSyncOperations([], occurrenceMappings, [], scope).operations).toHaveLength(
      occurrenceMappings.length,
    );
  });

  it("carries the remaining reconciliation boundaries onto the scope", () => {
    const scope = createScope([]);

    expect(scope.authoritativeWindow).toEqual(WINDOW);
    expect(scope.requestedWindow).toEqual(WINDOW);
    expect(scope.configuredSourceCalendarIds).toEqual(new Set([SOURCE_CALENDAR_ID]));
    expect(scope.authoritativeSourceWindows).toEqual(new Map([[SOURCE_CALENDAR_ID, WINDOW]]));
  });
});

describe("source authority for a destination with no mappings", () => {
  const REQUESTED_WINDOW = {
    timeMax: new Date("2028-07-18T00:00:00.000Z"),
    timeMin: new Date("2026-07-11T00:00:00.000Z"),
  };

  const KEEPER_REMOTE_EVENT = {
    deleteId: "remote-delete-1",
    endTime: new Date("2026-08-12T11:00:00.000Z"),
    isKeeperEvent: true,
    startTime: new Date("2026-08-12T10:00:00.000Z"),
    uid: `abcdef${KEEPER_EVENT_SUFFIX}`,
  };

  const createSourceCoverageDatabase = (rows: Record<string, unknown>[]) => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
  }) as unknown as Parameters<typeof resolveSourceAuthority>[0];

  it("grants no aggregate window when the destination has no configured sources", async () => {
    const authority = await resolveSourceAuthority(
      createSourceCoverageDatabase([]),
      [],
      REQUESTED_WINDOW,
    );

    expect(authority.aggregateWindow).toBeNull();
    expect(authority.sourceWindows.size).toBe(0);
    expect(createAggregateAuthorityWindow([], new Map(), REQUESTED_WINDOW)).toBeNull();
  });

  it("removes nothing from a remote calendar full of Keeper events", async () => {
    const authority = await resolveSourceAuthority(
      createSourceCoverageDatabase([]),
      [],
      REQUESTED_WINDOW,
    );

    const { operations } = computeSyncOperations([], [], [KEEPER_REMOTE_EVENT], {
      authoritativeSourceWindows: authority.sourceWindows,
      authoritativeWindow: authority.aggregateWindow,
      configuredSourceCalendarIds: new Set<string>(),
      requestedWindow: REQUESTED_WINDOW,
    });

    expect(operations).toEqual([]);
  });

  it("still retires mirrors left behind when the last mapping was removed", async () => {
    const authority = await resolveSourceAuthority(
      createSourceCoverageDatabase([]),
      [],
      REQUESTED_WINDOW,
    );

    const retainedMapping = {
      calendarId: "destination-1",
      deleteIdentifier: KEEPER_REMOTE_EVENT.deleteId,
      destinationEventUid: KEEPER_REMOTE_EVENT.uid,
      endTime: KEEPER_REMOTE_EVENT.endTime,
      eventStateId: null,
      id: "mapping-1",
      sourceCalendarId: "unmapped-source-1",
      startTime: KEEPER_REMOTE_EVENT.startTime,
      syncEventHash: null,
      syncEventId: "sync-event-1",
    };

    const { operations } = computeSyncOperations([], [retainedMapping], [KEEPER_REMOTE_EVENT], {
      authoritativeSourceWindows: authority.sourceWindows,
      authoritativeWindow: authority.aggregateWindow,
      configuredSourceCalendarIds: new Set<string>(),
      requestedWindow: REQUESTED_WINDOW,
    });

    expect(operations).toEqual([{
      deleteId: KEEPER_REMOTE_EVENT.deleteId,
      mappingId: retainedMapping.id,
      startTime: KEEPER_REMOTE_EVENT.startTime,
      type: "remove",
      uid: KEEPER_REMOTE_EVENT.uid,
    }]);
  });

  it("still reclaims a Keeper event once the destination has a verified source", async () => {
    const authority = await resolveSourceAuthority(
      createSourceCoverageDatabase([{ id: "source-1", ...COMPLETE_SOURCE_COVERAGE }]),
      ["source-1"],
      REQUESTED_WINDOW,
    );

    const { operations } = computeSyncOperations([], [], [KEEPER_REMOTE_EVENT], {
      authoritativeSourceWindows: authority.sourceWindows,
      authoritativeWindow: authority.aggregateWindow,
      configuredSourceCalendarIds: new Set(["source-1"]),
      requestedWindow: REQUESTED_WINDOW,
    });

    expect(authority.aggregateWindow).not.toBeNull();
    expect(operations).toEqual([{
      deleteId: KEEPER_REMOTE_EVENT.deleteId,
      startTime: KEEPER_REMOTE_EVENT.startTime,
      type: "remove",
      uid: KEEPER_REMOTE_EVENT.uid,
    }]);
  });
});
