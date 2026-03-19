import { describe, expect, it } from "bun:test";
import { SourceProvisioningStateMachine } from "./source-provisioning.machine";
import { createEventEnvelope } from "./core/event-envelope";
import type { EventActor } from "./core/event-envelope";
import { TransitionPolicy } from "./core/transition-policy";

let envelopeSequence = 0;
const envelope = <TEvent>(event: TEvent, actor: EventActor) => {
  envelopeSequence += 1;
  return createEventEnvelope(event, actor, {
    id: `env-provision-${envelopeSequence}`,
    occurredAt: `2026-03-19T10:20:${String(envelopeSequence).padStart(2, "0")}.000Z`,
  });
};

describe("SourceProvisioningMachine", () => {
  it("starts in validating state", () => {
    const machine = new SourceProvisioningStateMachine({
      mode: "create_single",
      provider: "ics",
      requestId: "req-1",
      userId: "user-1",
    }, { transitionPolicy: TransitionPolicy.IGNORE });

    expect(machine.getSnapshot().state).toBe("validating");
  });

  it("moves validating -> quota_check on validation passed", () => {
    const machine = new SourceProvisioningStateMachine({
      mode: "create_single",
      provider: "ics",
      requestId: "req-1",
      userId: "user-1",
    }, { transitionPolicy: TransitionPolicy.IGNORE });

    const result = machine.dispatch(
      envelope({ type: "VALIDATION_PASSED" }, { type: "user", id: "user-1" }),
    );

    expect(result.state).toBe("quota_check");
  });

  it("moves to rejected when quota denied", () => {
    const machine = new SourceProvisioningStateMachine({
      mode: "create_single",
      provider: "ics",
      requestId: "req-1",
      userId: "user-1",
    }, { transitionPolicy: TransitionPolicy.IGNORE });
    machine.dispatch(
      envelope({ type: "VALIDATION_PASSED" }, { type: "user", id: "user-1" }),
    );

    const result = machine.dispatch(
      envelope({ type: "QUOTA_DENIED" }, { type: "system", id: "billing" }),
    );

    expect(result.state).toBe("rejected");
    expect(result.context.rejectionReason).toBe("limit");
  });

  it("completes happy path and emits SOURCE_PROVISIONED output", () => {
    const machine = new SourceProvisioningStateMachine({
      mode: "create_single",
      provider: "google",
      requestId: "req-1",
      userId: "user-1",
    }, { transitionPolicy: TransitionPolicy.IGNORE });

    machine.dispatch(envelope({ type: "VALIDATION_PASSED" }, { type: "user", id: "user-1" }));
    machine.dispatch(envelope({ type: "QUOTA_ALLOWED" }, { type: "system", id: "billing" }));
    machine.dispatch(envelope({ type: "DEDUPLICATION_PASSED" }, { type: "system", id: "api" }));
    machine.dispatch(envelope({ accountId: "acc-1", type: "ACCOUNT_REUSED" }, { type: "system", id: "api" }));
    machine.dispatch(envelope({ sourceIds: ["src-1"], type: "SOURCE_CREATED" }, { type: "system", id: "api" }));

    const result = machine.dispatch(
      envelope(
        {
          mode: "create_single",
          sourceIds: ["src-1"],
          type: "BOOTSTRAP_SYNC_TRIGGERED",
        },
        { type: "system", id: "api" },
      ),
    );

    expect(result.state).toBe("done");
    expect(result.outputs).toContainEqual({
      mode: "create_single",
      sourceIds: ["src-1"],
      type: "SOURCE_PROVISIONED",
    });
  });

  it("rejects follow-up transitions after rejection in strict mode", () => {
    const machine = new SourceProvisioningStateMachine({
      mode: "create_single",
      provider: "ics",
      requestId: "req-3",
      userId: "user-3",
    }, { transitionPolicy: TransitionPolicy.REJECT });

    machine.dispatch(envelope({ type: "VALIDATION_PASSED" }, { type: "user", id: "user-3" }));
    machine.dispatch(envelope({ type: "QUOTA_DENIED" }, { type: "system", id: "billing" }));

    expect(() =>
      machine.dispatch(
        envelope({ type: "DEDUPLICATION_PASSED" }, { type: "system", id: "api" }),
      ),
    ).toThrow("Transition rejected");
  });
});
