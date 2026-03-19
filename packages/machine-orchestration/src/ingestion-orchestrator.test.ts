import { describe, expect, it } from "bun:test";
import {
  ErrorPolicy,
  IngestionFailureType,
  IngestionStateMachine,
  TransitionPolicy,
  createEventEnvelope,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { IngestionOrchestrator } from "./ingestion-orchestrator";

const buildEnvelopeFactory = (): EnvelopeFactory => {
  let sequence = 0;
  return {
    createEnvelope: (event, actor) => {
      sequence += 1;
      return createEventEnvelope(event, actor, {
        id: `env-orch-ingest-${sequence}`,
        occurredAt: `2026-03-19T11:10:${String(sequence).padStart(2, "0")}.000Z`,
      });
    },
  };
};

describe("IngestionOrchestrator", () => {
  it("emits SOURCE_CHANGED output when ingestion applies changes", () => {
    const orchestrator = new IngestionOrchestrator({
      machine: new IngestionStateMachine({
        accountId: "acct-1",
        provider: "google",
        sourceCalendarId: "source-1",
        userId: "user-1",
      }, { transitionPolicy: TransitionPolicy.IGNORE }),
      envelopeFactory: buildEnvelopeFactory(),
    });

    orchestrator.handle({ actorId: "svc-worker", type: "INGESTION_RUN_REQUESTED" });
    orchestrator.handle({ actorId: "svc-worker", type: "REMOTE_FETCH_SUCCEEDED" });
    orchestrator.handle({ actorId: "svc-worker", type: "DIFF_SUCCEEDED" });
    const transition = orchestrator.handleTransition({
      actorId: "svc-worker",
      eventsAdded: 3,
      eventsRemoved: 1,
      type: "APPLY_COMPLETED",
    });

    expect(transition.state).toBe("completed");
    expect(transition.outputs).toContainEqual({
      eventsAdded: 3,
      eventsRemoved: 1,
      type: "SOURCE_CHANGED",
    });
  });

  it("emits SOURCE_UNCHANGED when ingestion has no content changes", () => {
    const orchestrator = new IngestionOrchestrator({
      machine: new IngestionStateMachine({
        accountId: "acct-2",
        provider: "google",
        sourceCalendarId: "source-2",
        userId: "user-2",
      }, { transitionPolicy: TransitionPolicy.IGNORE }),
      envelopeFactory: buildEnvelopeFactory(),
    });

    orchestrator.handle({ actorId: "svc-worker", type: "INGESTION_RUN_REQUESTED" });
    orchestrator.handle({ actorId: "svc-worker", type: "REMOTE_FETCH_SUCCEEDED" });
    orchestrator.handle({ actorId: "svc-worker", type: "DIFF_SUCCEEDED" });
    const transition = orchestrator.handleTransition({
      actorId: "svc-worker",
      eventsAdded: 0,
      eventsRemoved: 0,
      type: "APPLY_COMPLETED",
    });

    expect(transition.state).toBe("completed");
    expect(transition.outputs).toEqual([{ type: "SOURCE_UNCHANGED" }]);
  });

  it("transitions to auth blocked with no sync side effects", () => {
    const orchestrator = new IngestionOrchestrator({
      machine: new IngestionStateMachine({
        accountId: "acct-3",
        provider: "google",
        sourceCalendarId: "source-3",
        userId: "user-3",
      }, { transitionPolicy: TransitionPolicy.IGNORE }),
      envelopeFactory: buildEnvelopeFactory(),
    });

    orchestrator.handle({ actorId: "svc-worker", type: "INGESTION_RUN_REQUESTED" });
    const snapshot = orchestrator.handle({
      actorId: "svc-worker",
      code: "TOKEN_EXPIRED",
      type: "FETCH_AUTH_FAILED",
    });

    expect(snapshot.state).toBe("auth_blocked");
    expect(snapshot.context.lastError?.policy).toBe(ErrorPolicy.REQUIRES_REAUTH);
  });

  it("marks timeout failures as retryable transient errors", () => {
    const orchestrator = new IngestionOrchestrator({
      machine: new IngestionStateMachine({
        accountId: "acct-4",
        provider: "google",
        sourceCalendarId: "source-4",
        userId: "user-4",
      }, { transitionPolicy: TransitionPolicy.IGNORE }),
      envelopeFactory: buildEnvelopeFactory(),
    });

    orchestrator.handle({ actorId: "svc-worker", type: "INGESTION_RUN_REQUESTED" });
    const snapshot = orchestrator.handle({
      actorId: "svc-worker",
      code: "FETCH_TIMEOUT",
      type: "FETCH_TIMEOUT",
    });

    expect(snapshot.state).toBe("transient_error");
    expect(snapshot.context.lastError?.policy).toBe(ErrorPolicy.RETRYABLE);
    expect(snapshot.context.lastError?.code).toBe("FETCH_TIMEOUT");
  });

  it("surfaces source failure output classification", () => {
    const orchestrator = new IngestionOrchestrator({
      machine: new IngestionStateMachine({
        accountId: "acct-5",
        provider: "google",
        sourceCalendarId: "source-5",
        userId: "user-5",
      }, { transitionPolicy: TransitionPolicy.IGNORE }),
      envelopeFactory: buildEnvelopeFactory(),
    });

    orchestrator.handle({ actorId: "svc-worker", type: "INGESTION_RUN_REQUESTED" });
    const transitionResult = orchestrator.handleTransition({
      actorId: "svc-worker",
      code: "NOT_FOUND",
      type: "FETCH_NOT_FOUND",
    });

    expect(transitionResult.outputs).toEqual([
      {
        code: "NOT_FOUND",
        failureType: IngestionFailureType.NOT_FOUND,
        policy: ErrorPolicy.TERMINAL,
        type: "SOURCE_FAILED",
      },
    ]);
  });
});
