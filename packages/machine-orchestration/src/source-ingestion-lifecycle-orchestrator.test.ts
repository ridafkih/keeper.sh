import { describe, expect, it } from "bun:test";
import {
  SourceIngestionLifecycleCommandType,
  SourceIngestionLifecycleEventType,
  SourceIngestionLifecycleStateMachine,
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { SourceIngestionLifecycleOrchestrator } from "./source-ingestion-lifecycle-orchestrator";

const buildEnvelopeFactory = (): EnvelopeFactory => {
  let sequence = 0;
  return {
    createEnvelope: (event, actor) => {
      sequence += 1;
      return {
        actor,
        event,
        id: `env-source-ingestion-${sequence}`,
        occurredAt: `2026-03-19T14:00:${String(sequence).padStart(2, "0")}.000Z`,
      };
    },
  };
};

describe("SourceIngestionLifecycleOrchestrator", () => {
  it("persists next sync token on successful ingest", () => {
    const orchestrator = new SourceIngestionLifecycleOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SourceIngestionLifecycleStateMachine(
        { provider: "google", sourceId: "src-1" },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    orchestrator.handleTransition({ actorId: "worker-1", type: SourceIngestionLifecycleEventType.SOURCE_SELECTED });
    orchestrator.handleTransition({ actorId: "worker-1", type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED });
    orchestrator.handleTransition({ actorId: "worker-1", type: SourceIngestionLifecycleEventType.FETCH_SUCCEEDED });
    const transition = orchestrator.handleTransition({
      actorId: "worker-1",
      eventsAdded: 1,
      eventsRemoved: 0,
      nextSyncToken: "next-sync-token",
      type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
    });

    expect(transition.state).toBe("completed");
    expect(transition.commands).toEqual([
      { syncToken: "next-sync-token", type: SourceIngestionLifecycleCommandType.PERSIST_SYNC_TOKEN },
    ]);
  });

  it("marks reauth required on auth failure", () => {
    const orchestrator = new SourceIngestionLifecycleOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SourceIngestionLifecycleStateMachine(
        { provider: "google", sourceId: "src-1" },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    orchestrator.handleTransition({ actorId: "worker-1", type: SourceIngestionLifecycleEventType.SOURCE_SELECTED });
    orchestrator.handleTransition({ actorId: "worker-1", type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED });
    const transition = orchestrator.handleTransition({
      actorId: "worker-1",
      code: "invalid_grant",
      type: SourceIngestionLifecycleEventType.AUTH_FAILURE,
    });

    expect(transition.state).toBe("auth_blocked");
    expect(transition.commands).toEqual([{ type: SourceIngestionLifecycleCommandType.MARK_NEEDS_REAUTH }]);
  });

  it("rejects out-of-order ingest success in strict mode", () => {
    const orchestrator = new SourceIngestionLifecycleOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SourceIngestionLifecycleStateMachine(
        { provider: "google", sourceId: "src-1" },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    expect(() =>
      orchestrator.handleTransition({
        actorId: "worker-1",
        eventsAdded: 1,
        eventsRemoved: 0,
        type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
      }),
    ).toThrow("Transition rejected");
  });
});
