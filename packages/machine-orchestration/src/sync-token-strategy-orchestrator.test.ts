import { describe, expect, it } from "bun:test";
import { SyncTokenStrategyStateMachine, TransitionPolicy } from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { SyncTokenStrategyOrchestrator } from "./sync-token-strategy-orchestrator";

const buildEnvelopeFactory = (): EnvelopeFactory => {
  let sequence = 0;
  return {
    createEnvelope: (event, actor) => {
      sequence += 1;
      return {
        actor,
        event,
        id: `env-token-${sequence}`,
        occurredAt: `2026-03-19T16:00:${String(sequence).padStart(2, "0")}.000Z`,
      };
    },
  };
};

describe("SyncTokenStrategyOrchestrator", () => {
  it("resets stale token window and requests full sync", () => {
    const orchestrator = new SyncTokenStrategyOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SyncTokenStrategyStateMachine(
        { requiredWindowVersion: 2 },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    const transition = orchestrator.handleTransition({
      actorId: "svc-sync",
      loadedWindowVersion: 1,
      token: "old-token",
      type: "TOKEN_LOADED",
    });

    expect(transition.state).toBe("token_reset_required");
    expect(transition.commands).toEqual([
      { type: "CLEAR_SYNC_TOKEN" },
      { type: "REQUEST_FULL_SYNC" },
    ]);
  });

  it("persists next token after delta path", () => {
    const orchestrator = new SyncTokenStrategyOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SyncTokenStrategyStateMachine(
        { requiredWindowVersion: 1 },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    orchestrator.handleTransition({
      actorId: "svc-sync",
      loadedWindowVersion: 1,
      token: "token-1",
      type: "TOKEN_LOADED",
    });
    orchestrator.handleTransition({ actorId: "svc-sync", type: "DELTA_SYNC_REQUESTED" });
    const transition = orchestrator.handleTransition({
      actorId: "svc-sync",
      token: "token-2",
      type: "NEXT_TOKEN_RECEIVED",
    });

    expect(transition.state).toBe("token_persist_pending");
    expect(transition.commands).toEqual([{ token: "token-2", type: "PERSIST_SYNC_TOKEN" }]);
  });

  it("rejects out-of-order next token in strict mode", () => {
    const orchestrator = new SyncTokenStrategyOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SyncTokenStrategyStateMachine(
        { requiredWindowVersion: 1 },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    expect(() =>
      orchestrator.handleTransition({
        actorId: "svc-sync",
        token: "token-2",
        type: "NEXT_TOKEN_RECEIVED",
      }),
    ).toThrow("Transition rejected");
  });
});
