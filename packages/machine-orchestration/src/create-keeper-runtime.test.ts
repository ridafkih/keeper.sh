import { describe, expect, it } from "bun:test";
import { SourceIngestionLifecycleEventType, TransitionPolicy } from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { createKeeperRuntime } from "./create-keeper-runtime";

const buildEnvelopeFactory = (): EnvelopeFactory => {
  let sequence = 0;
  return {
    createEnvelope: (event, actor) => {
      sequence += 1;
      return {
        actor,
        event,
        id: `env-runtime-${sequence}`,
        occurredAt: `2026-03-19T12:00:${String(sequence).padStart(2, "0")}.000Z`,
      };
    },
  };
};

describe("createKeeperRuntime", () => {
  it("builds a fully wired runtime from explicit dependencies", () => {
    const enqueues: { idempotencyKey: string; userId: string }[] = [];
    const broadcasts: string[] = [];
    const runtime = createKeeperRuntime({
      broadcaster: {
        publishLifecycleUpdate: (userId) => {
          broadcasts.push(userId);
        },
      },
      credentialHealthContext: {
        accessTokenExpiresAt: "2026-03-19T17:00:00.000Z",
        calendarAccountId: "acc-1",
        oauthCredentialId: "cred-1",
      },
      destinationExecutionContext: {
        calendarId: "cal-1",
        failureCount: 0,
      },
      envelopeFactory: buildEnvelopeFactory(),
      ingestionInput: {
        accountId: "acc-1",
        provider: "google",
        sourceCalendarId: "src-1",
        userId: "user-1",
      },
      jobCoordinator: {
        requestEnqueueIdempotent: (userId, idempotencyKey) => {
          enqueues.push({ idempotencyKey, userId });
        },
      },
      sourceProvisioningInput: {
        mode: "create_single",
        provider: "google",
        requestId: "req-1",
        userId: "user-1",
      },
      sourceIngestionLifecycleContext: {
        provider: "google",
        sourceId: "src-1",
      },
      syncTokenStrategyContext: {
        requiredWindowVersion: 1,
      },
      transitionPolicy: TransitionPolicy.IGNORE,
      userId: "user-1",
    });

    runtime.handleIngestionEvent({ actorId: "svc-worker", type: "INGESTION_RUN_REQUESTED" });
    runtime.handleIngestionEvent({ actorId: "svc-worker", type: "REMOTE_FETCH_SUCCEEDED" });
    runtime.handleIngestionEvent({ actorId: "svc-worker", type: "DIFF_SUCCEEDED" });
    runtime.handleIngestionEvent({
      actorId: "svc-worker",
      eventsAdded: 2,
      eventsRemoved: 0,
      type: "APPLY_COMPLETED",
    });

    expect(enqueues.length).toBe(1);
    expect(enqueues[0]?.userId).toBe("user-1");
    expect(broadcasts).toEqual([]);
  });

  it("routes provisioning bootstrap output into sync runtime request", () => {
    const enqueues: { idempotencyKey: string; userId: string }[] = [];
    let broadcasts = 0;
    const runtime = createKeeperRuntime({
      broadcaster: {
        publishLifecycleUpdate: () => {
          broadcasts += 1;
        },
      },
      credentialHealthContext: {
        accessTokenExpiresAt: "2026-03-19T17:00:00.000Z",
        calendarAccountId: "acc-2",
        oauthCredentialId: "cred-2",
      },
      destinationExecutionContext: {
        calendarId: "cal-2",
        failureCount: 0,
      },
      envelopeFactory: buildEnvelopeFactory(),
      ingestionInput: {
        accountId: "acc-2",
        provider: "google",
        sourceCalendarId: "src-2",
        userId: "user-2",
      },
      jobCoordinator: {
        requestEnqueueIdempotent: (userId, idempotencyKey) => {
          enqueues.push({ idempotencyKey, userId });
        },
      },
      sourceProvisioningInput: {
        mode: "create_single",
        provider: "google",
        requestId: "req-2",
        userId: "user-2",
      },
      sourceIngestionLifecycleContext: {
        provider: "google",
        sourceId: "src-2",
      },
      syncTokenStrategyContext: {
        requiredWindowVersion: 1,
      },
      transitionPolicy: TransitionPolicy.IGNORE,
      userId: "user-2",
    });

    runtime.handleSourceProvisioningEvent({ actorId: "user-2", type: "REQUEST_VALIDATED" });
    runtime.handleSourceProvisioningEvent({ actorId: "svc-billing", type: "QUOTA_GRANTED" });
    runtime.handleSourceProvisioningEvent({ actorId: "svc-api", type: "DEDUPLICATION_PASSED" });
    runtime.handleSourceProvisioningEvent({ actorId: "svc-api", accountId: "acc-2", type: "ACCOUNT_CREATED" });
    runtime.handleSourceProvisioningEvent({ actorId: "svc-api", sourceIds: ["src-2"], type: "SOURCE_CREATED" });
    runtime.handleSourceProvisioningEvent({
      actorId: "svc-api",
      mode: "create_single",
      sourceIds: ["src-2"],
      type: "BOOTSTRAP_SYNC_TRIGGERED",
    });

    expect(enqueues.length).toBe(1);
    expect(enqueues[0]?.userId).toBe("user-2");
    expect(broadcasts).toBe(0);
  });

  it("routes additional slice events through isolated orchestrators", () => {
    const runtime = createKeeperRuntime({
      broadcaster: {
        publishLifecycleUpdate: () => 0,
      },
      credentialHealthContext: {
        accessTokenExpiresAt: "2026-03-19T17:00:00.000Z",
        calendarAccountId: "acc-3",
        oauthCredentialId: "cred-3",
      },
      destinationExecutionContext: {
        calendarId: "cal-3",
        failureCount: 0,
      },
      envelopeFactory: buildEnvelopeFactory(),
      ingestionInput: {
        accountId: "acc-3",
        provider: "google",
        sourceCalendarId: "src-3",
        userId: "user-3",
      },
      jobCoordinator: {
        requestEnqueueIdempotent: () => 0,
      },
      sourceIngestionLifecycleContext: {
        provider: "google",
        sourceId: "src-3",
      },
      sourceProvisioningInput: {
        mode: "create_single",
        provider: "google",
        requestId: "req-3",
        userId: "user-3",
      },
      syncTokenStrategyContext: {
        requiredWindowVersion: 2,
      },
      transitionPolicy: TransitionPolicy.REJECT,
      userId: "user-3",
    });

    const arbitration = runtime.handlePushJobArbitrationEvent({
      actorId: "worker-push",
      jobId: "job-1",
      type: "JOB_ACTIVATED",
    });
    expect(arbitration.commands).toEqual([{ type: "HOLD_SYNCING" }]);

    runtime.handleDestinationExecutionEvent({ actorId: "worker-sync", holderId: "lock-1", type: "LOCK_ACQUIRED" });
    runtime.handleDestinationExecutionEvent({ actorId: "worker-sync", type: "EXECUTION_STARTED" });
    const destination = runtime.handleDestinationExecutionEvent({
      actorId: "worker-sync",
      code: "timeout",
      nextAttemptAt: "2026-03-19T18:00:00.000Z",
      type: "EXECUTION_RETRYABLE_FAILED",
    });
    expect(destination.state).toBe("backoff_scheduled");

    runtime.handleSourceIngestionLifecycleEvent({
      actorId: "worker-ingest",
      type: SourceIngestionLifecycleEventType.SOURCE_SELECTED,
    });
    runtime.handleSourceIngestionLifecycleEvent({
      actorId: "worker-ingest",
      type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED,
    });
    const sourceIngestion = runtime.handleSourceIngestionLifecycleEvent({
      actorId: "worker-ingest",
      code: "timeout",
      type: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE,
    });
    expect(sourceIngestion.state).toBe("transient_error");

    const credential = runtime.handleCredentialHealthEvent({
      actorId: "worker-auth",
      type: "TOKEN_EXPIRY_DETECTED",
    });
    expect(credential.commands).toEqual([{ type: "REFRESH_TOKEN" }]);

    const token = runtime.handleSyncTokenStrategyEvent({
      actorId: "svc-sync",
      loadedWindowVersion: 1,
      token: "token-old",
      type: "TOKEN_LOADED",
    });
    expect(token.state).toBe("token_reset_required");
  });
});
