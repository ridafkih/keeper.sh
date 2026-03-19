import { describe, expect, it } from "bun:test";
import { SourceProvisioningStateMachine } from "./source-provisioning.machine";
import { createEventEnvelope } from "./core/event-envelope";

describe("SourceProvisioningMachine", () => {
  it("starts in validating state", () => {
    const machine = new SourceProvisioningStateMachine({
      mode: "create_single",
      provider: "ics",
      requestId: "req-1",
      userId: "user-1",
    });

    expect(machine.getSnapshot().state).toBe("validating");
  });

  it("moves validating -> quota_check on validation passed", () => {
    const machine = new SourceProvisioningStateMachine({
      mode: "create_single",
      provider: "ics",
      requestId: "req-1",
      userId: "user-1",
    });

    const result = machine.dispatch(
      createEventEnvelope({ type: "VALIDATION_PASSED" }, { type: "user", id: "user-1" }),
    );

    expect(result.state).toBe("quota_check");
  });

  it("moves to rejected when quota denied", () => {
    const machine = new SourceProvisioningStateMachine({
      mode: "create_single",
      provider: "ics",
      requestId: "req-1",
      userId: "user-1",
    });
    machine.dispatch(
      createEventEnvelope({ type: "VALIDATION_PASSED" }, { type: "user", id: "user-1" }),
    );

    const result = machine.dispatch(
      createEventEnvelope({ type: "QUOTA_DENIED" }, { type: "system", id: "billing" }),
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
    });

    machine.dispatch(createEventEnvelope({ type: "VALIDATION_PASSED" }, { type: "user", id: "user-1" }));
    machine.dispatch(createEventEnvelope({ type: "QUOTA_ALLOWED" }, { type: "system", id: "billing" }));
    machine.dispatch(createEventEnvelope({ type: "DEDUPLICATION_PASSED" }, { type: "system", id: "api" }));
    machine.dispatch(createEventEnvelope({ accountId: "acc-1", type: "ACCOUNT_REUSED" }, { type: "system", id: "api" }));
    machine.dispatch(createEventEnvelope({ sourceIds: ["src-1"], type: "SOURCE_CREATED" }, { type: "system", id: "api" }));

    const result = machine.dispatch(
      createEventEnvelope(
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
});
