import { describe, expect, it, vi } from "vitest";
import {
  createDestinationReconciliationWideEventFields,
  readDestinationReconciliationState,
} from "../src/sync-user";

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

describe("createDestinationReconciliationWideEventFields", () => {
  const eventReadDiagnostics = {
    candidateEventStateCount: 8,
    excludedBySyncPolicyCount: 2,
    materializedEventCount: 5,
    missingSourceEventUidCount: 1,
    outsideReconciliationWindowCount: 1,
    syncableEventCount: 4,
  };

  it("records each stage that can reduce the local destination snapshot to zero", () => {
    expect(createDestinationReconciliationWideEventFields({
      eventReadDiagnostics,
      localReadDurationMs: 12.5,
      reconciliationWindow: {
        timeMax: new Date("2028-07-18T00:00:00.000Z"),
        timeMin: new Date("2026-07-11T00:00:00.000Z"),
      },
      remoteReadDurationMs: 42.25,
      sourceCalendarIdsAtLocalRead: ["source-1", "source-2"],
      sourceCalendarIdsBeforeRemoteRead: ["source-1", "source-2"],
    })).toEqual({
      "local_event_states.candidate_count": 8,
      "local_event_states.excluded_by_sync_policy_count": 2,
      "local_event_states.materialized_count": 5,
      "local_event_states.missing_source_event_uid_count": 1,
      "local_event_states.outside_reconciliation_window_count": 1,
      "local_event_states.syncable_count": 4,
      "reconciliation.local_read.duration_ms": 12.5,
      "reconciliation.remote_read.duration_ms": 42.25,
      "reconciliation.source_calendars.at_local_read_count": 2,
      "reconciliation.source_calendars.before_remote_read_count": 2,
      "reconciliation.source_calendars.changed_during_remote_read": false,
      "reconciliation.window.recurrence_time_max": "2028-07-18T00:00:00.000Z",
      "reconciliation.window.time_min": "2026-07-11T00:00:00.000Z",
    });
  });

  it("detects a same-sized source mapping replacement without depending on query order", () => {
    const reordered = createDestinationReconciliationWideEventFields({
      eventReadDiagnostics,
      localReadDurationMs: 1,
      reconciliationWindow: {
        timeMax: new Date("2028-07-18T00:00:00.000Z"),
        timeMin: new Date("2026-07-11T00:00:00.000Z"),
      },
      remoteReadDurationMs: 2,
      sourceCalendarIdsAtLocalRead: ["source-2", "source-1"],
      sourceCalendarIdsBeforeRemoteRead: ["source-1", "source-2"],
    });
    const replaced = createDestinationReconciliationWideEventFields({
      eventReadDiagnostics,
      localReadDurationMs: 1,
      reconciliationWindow: {
        timeMax: new Date("2028-07-18T00:00:00.000Z"),
        timeMin: new Date("2026-07-11T00:00:00.000Z"),
      },
      remoteReadDurationMs: 2,
      sourceCalendarIdsAtLocalRead: ["source-1", "source-3"],
      sourceCalendarIdsBeforeRemoteRead: ["source-1", "source-2"],
    });

    expect(reordered["reconciliation.source_calendars.changed_during_remote_read"]).toBe(false);
    expect(replaced["reconciliation.source_calendars.changed_during_remote_read"]).toBe(true);
  });
});
