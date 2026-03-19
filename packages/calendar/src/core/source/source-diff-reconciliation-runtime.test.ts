import { describe, expect, it } from "bun:test";
import {
  SourceDiffReconciliationEventType,
  TransitionPolicy,
  type EventEnvelopeMetadata,
} from "@keeper.sh/state-machines";
import type { ExistingSourceEventState } from "./event-diff";
import type { SourceEvent } from "../types";
import {
  createSourceDiffReconciliationRuntime,
  type SourceDiffReconciliationFetchResult,
} from "./source-diff-reconciliation-runtime";

const createEnvelope = (id: string): EventEnvelopeMetadata & { actor: { type: "system"; id: string } } => ({
  actor: { id: "source-runtime", type: "system" },
  id,
  occurredAt: "2026-03-19T16:00:00.000Z",
});

const createSourceEvent = (
  uid: string,
  startIso: string,
  endIso: string,
  overrides: Partial<SourceEvent> = {},
): SourceEvent => ({
  uid,
  startTime: new Date(startIso),
  endTime: new Date(endIso),
  ...overrides,
});

const createExistingState = (
  id: string,
  uid: string,
  startIso: string,
  endIso: string,
  overrides: Partial<ExistingSourceEventState> = {},
): ExistingSourceEventState => ({
  id,
  sourceEventUid: uid,
  startTime: new Date(startIso),
  endTime: new Date(endIso),
  ...overrides,
});

describe("createSourceDiffReconciliationRuntime", () => {
  it("computes and applies insert/update/remove plan", async () => {
    const appliedPlans: unknown[] = [];
    const runtime = createSourceDiffReconciliationRuntime({
      applyDiff: (plan) => {
        appliedPlans.push(plan);
        return Promise.resolve();
      },
      fetchEvents: (): Promise<SourceDiffReconciliationFetchResult> => Promise.resolve({
        cancelledEventUids: [],
        events: [
          createSourceEvent("uid-a", "2026-03-20T10:00:00.000Z", "2026-03-20T11:00:00.000Z", { isAllDay: true }),
          createSourceEvent("uid-c", "2026-03-20T12:00:00.000Z", "2026-03-20T13:00:00.000Z"),
        ],
        isDeltaSync: false,
      }),
      isRetryableError: () => false,
      readExistingEvents: () => Promise.resolve([
        createExistingState("state-a", "uid-a", "2026-03-20T10:00:00.000Z", "2026-03-20T11:00:00.000Z", { isAllDay: null }),
        createExistingState("state-b", "uid-b", "2026-03-20T09:00:00.000Z", "2026-03-20T09:30:00.000Z"),
      ]),
      resolveErrorCode: () => "unexpected",
      sourceId: "source-1",
      transitionPolicy: TransitionPolicy.REJECT,
    });

    const transition = await runtime.reconcile(createEnvelope("env-1"));

    expect(transition.state).toBe("completed");
    expect(transition.outputs).toEqual([{ changed: true, type: "RECONCILIATION_COMPLETED" }]);
    expect(appliedPlans).toHaveLength(1);
    expect(appliedPlans[0]).toMatchObject({
      addedCount: 1,
      removedCount: 1,
      updatedCount: 1,
      eventStateIdsToRemove: ["state-b"],
    });
  });

  it("deduplicates replayed reconciliation envelope id", async () => {
    let readCount = 0;
    let fetchCount = 0;
    let applyCount = 0;

    const runtime = createSourceDiffReconciliationRuntime({
      applyDiff: () => {
        applyCount += 1;
        return Promise.resolve();
      },
      fetchEvents: (): Promise<SourceDiffReconciliationFetchResult> => {
        fetchCount += 1;
        return Promise.resolve({ cancelledEventUids: [], events: [], isDeltaSync: false });
      },
      isRetryableError: () => false,
      readExistingEvents: () => {
        readCount += 1;
        return Promise.resolve([]);
      },
      resolveErrorCode: () => "unexpected",
      sourceId: "source-2",
      transitionPolicy: TransitionPolicy.REJECT,
    });

    const first = await runtime.reconcile(createEnvelope("replay-1"));
    const second = await runtime.reconcile(createEnvelope("replay-1"));

    expect(first.state).toBe("completed");
    expect(second.state).toBe("completed");
    expect(readCount).toBe(1);
    expect(fetchCount).toBe(1);
    expect(applyCount).toBe(0);
  });

  it("rejects out-of-order runtime dispatch in strict policy", () => {
    const runtime = createSourceDiffReconciliationRuntime({
      applyDiff: () => Promise.resolve(),
      fetchEvents: (): Promise<SourceDiffReconciliationFetchResult> => Promise.resolve({
        cancelledEventUids: [],
        events: [],
        isDeltaSync: false,
      }),
      isRetryableError: () => false,
      readExistingEvents: () => Promise.resolve([]),
      resolveErrorCode: () => "unexpected",
      sourceId: "source-3",
      transitionPolicy: TransitionPolicy.REJECT,
    });

    expect(() =>
      runtime.dispatchEvent(
        { type: SourceDiffReconciliationEventType.APPLY_SUCCEEDED },
        createEnvelope("out-of-order-1"),
      ),
    ).toThrow("Transition rejected");
  });

  it("marks retryable failure when apply throws retryable error", async () => {
    const runtime = createSourceDiffReconciliationRuntime({
      applyDiff: () => Promise.reject(new Error("temporary")),
      fetchEvents: (): Promise<SourceDiffReconciliationFetchResult> => Promise.resolve({
        cancelledEventUids: [],
        events: [createSourceEvent("uid-x", "2026-03-20T15:00:00.000Z", "2026-03-20T16:00:00.000Z")],
        isDeltaSync: false,
      }),
      isRetryableError: () => true,
      readExistingEvents: () => Promise.resolve([]),
      resolveErrorCode: () => "timeout",
      sourceId: "source-4",
      transitionPolicy: TransitionPolicy.REJECT,
    });

    await expect(runtime.reconcile(createEnvelope("err-1"))).rejects.toThrow("temporary");
    expect(runtime.getSnapshot().state).toBe("failed_retryable");
  });
});
