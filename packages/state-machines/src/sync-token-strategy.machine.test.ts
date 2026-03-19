import { describe, expect, it } from "bun:test";
import { createEventEnvelope } from "./core/event-envelope";
import type { EventActor } from "./core/event-envelope";
import { TransitionPolicy } from "./core/transition-policy";
import { SyncTokenStrategyStateMachine } from "./sync-token-strategy.machine";

let envelopeSequence = 0;
const envelope = <TEvent>(event: TEvent, actor: EventActor) => {
  envelopeSequence += 1;
  return createEventEnvelope(event, actor, {
    id: `env-token-${envelopeSequence}`,
    occurredAt: `2026-03-19T13:40:${String(envelopeSequence).padStart(2, "0")}.000Z`,
  });
};

describe("SyncTokenStrategyStateMachine", () => {
  it("becomes token_valid when loading current token", () => {
    const machine = new SyncTokenStrategyStateMachine(
      { requiredWindowVersion: 2 },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );

    const transition = machine.dispatch(
      envelope(
        { loadedWindowVersion: 2, token: "token-1", type: "TOKEN_LOADED" },
        { type: "system", id: "provider" },
      ),
    );

    expect(transition.state).toBe("token_valid");
    expect(transition.outputs).toEqual([{ type: "TOKEN_READY_FOR_DELTA_SYNC" }]);
  });

  it("resets token and requests full sync when loaded token window is stale", () => {
    const machine = new SyncTokenStrategyStateMachine(
      { requiredWindowVersion: 3 },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );

    const transition = machine.dispatch(
      envelope(
        { loadedWindowVersion: 1, token: "token-old", type: "TOKEN_LOADED" },
        { type: "system", id: "provider" },
      ),
    );

    expect(transition.state).toBe("token_reset_required");
    expect(transition.commands).toEqual([
      { type: "CLEAR_SYNC_TOKEN" },
      { type: "REQUEST_FULL_SYNC" },
    ]);
  });

  it("persists next token after delta/full sync", () => {
    const machine = new SyncTokenStrategyStateMachine(
      { requiredWindowVersion: 2 },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(envelope({ loadedWindowVersion: 2, token: "token-1", type: "TOKEN_LOADED" }, { type: "system", id: "provider" }));
    machine.dispatch(envelope({ type: "DELTA_SYNC_REQUESTED" }, { type: "system", id: "provider" }));

    const transition = machine.dispatch(
      envelope({ token: "token-2", type: "NEXT_TOKEN_RECEIVED" }, { type: "system", id: "provider" }),
    );

    expect(transition.state).toBe("token_persist_pending");
    expect(transition.commands).toEqual([{ token: "token-2", type: "PERSIST_SYNC_TOKEN" }]);
  });

  it("rejects invalid next-token event in strict mode", () => {
    const machine = new SyncTokenStrategyStateMachine(
      { requiredWindowVersion: 1 },
      { transitionPolicy: TransitionPolicy.REJECT },
    );

    expect(() =>
      machine.dispatch(
        envelope({ token: "token-x", type: "NEXT_TOKEN_RECEIVED" }, { type: "system", id: "provider" }),
      ),
    ).toThrow("Transition rejected");
  });

  it("clears token when invalidated after delta start", () => {
    const machine = new SyncTokenStrategyStateMachine(
      { requiredWindowVersion: 1 },
      { transitionPolicy: TransitionPolicy.REJECT },
    );
    machine.dispatch(envelope({ loadedWindowVersion: 1, token: "token-1", type: "TOKEN_LOADED" }, { type: "system", id: "provider" }));
    machine.dispatch(envelope({ type: "DELTA_SYNC_REQUESTED" }, { type: "system", id: "provider" }));

    const transition = machine.dispatch(
      envelope({ type: "TOKEN_INVALIDATED" }, { type: "system", id: "provider" }),
    );

    expect(transition.state).toBe("token_reset_required");
    expect(transition.commands).toEqual([{ type: "CLEAR_SYNC_TOKEN" }]);
  });

  it("ignores replayed token load in ignore mode", () => {
    const machine = new SyncTokenStrategyStateMachine(
      { requiredWindowVersion: 1 },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(
      envelope(
        { loadedWindowVersion: 1, token: "token-1", type: "TOKEN_LOADED" },
        { type: "system", id: "provider" },
      ),
    );

    const replay = machine.dispatch(
      envelope(
        { loadedWindowVersion: 1, token: "token-2", type: "TOKEN_LOADED" },
        { type: "system", id: "provider" },
      ),
    );

    expect(replay.state).toBe("token_valid");
    expect(replay.context.syncToken).toBe("token-1");
    expect(replay.commands).toEqual([]);
  });
});
