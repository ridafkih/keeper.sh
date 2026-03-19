import { describe, expect, it } from "bun:test";
import { withMachineSubscription } from "./with-subscription";
import { createEventEnvelope } from "./event-envelope";
import { SyncLifecycleStateMachine } from "../sync-lifecycle.machine";

describe("withMachineSubscription", () => {
  it("unsubscribes automatically after callback", () => {
    const machine = new SyncLifecycleStateMachine();
    let notifications = 0;

    withMachineSubscription(
      machine,
      () => {
        notifications += 1;
      },
      () => {
        machine.dispatch(createEventEnvelope({ type: "INGEST_CHANGED" }, { type: "system", id: "cron" }));
      },
    );

    machine.dispatch(createEventEnvelope({ type: "MANUAL_SYNC_REQUESTED" }, { type: "system", id: "api" }));

    expect(notifications).toBe(1);
  });

  it("still unsubscribes when callback throws", () => {
    const machine = new SyncLifecycleStateMachine();
    let notifications = 0;

    expect(() =>
      withMachineSubscription(
        machine,
        () => {
          notifications += 1;
        },
        () => {
          machine.dispatch(createEventEnvelope({ type: "INGEST_CHANGED" }, { type: "system", id: "cron" }));
          throw new Error("boom");
        },
      ),
    ).toThrow("boom");

    machine.dispatch(createEventEnvelope({ type: "MANUAL_SYNC_REQUESTED" }, { type: "system", id: "api" }));
    expect(notifications).toBe(1);
  });
});
