import { describe, expect, it } from "bun:test";
import { withMachineSubscription } from "./with-subscription";
import { createEventEnvelope } from "./event-envelope";
import type { EventActor } from "./event-envelope";
import { SyncLifecycleStateMachine } from "../sync-lifecycle.machine";
import { TransitionPolicy } from "./transition-policy";

let envelopeSequence = 0;
const envelope = <TEvent>(event: TEvent, actor: EventActor) => {
  envelopeSequence += 1;
  return createEventEnvelope(event, actor, {
    id: `env-sub-${envelopeSequence}`,
    occurredAt: `2026-03-19T10:30:${String(envelopeSequence).padStart(2, "0")}.000Z`,
  });
};

describe("withMachineSubscription", () => {
  it("unsubscribes automatically after callback", () => {
    const machine = new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });
    let notifications = 0;

    withMachineSubscription(
      machine,
      () => {
        notifications += 1;
      },
      () => {
        machine.dispatch(envelope({ type: "INGEST_CHANGED" }, { type: "system", id: "cron" }));
      },
    );

    machine.dispatch(envelope({ type: "MANUAL_SYNC_REQUESTED" }, { type: "system", id: "api" }));

    expect(notifications).toBe(1);
  });

  it("still unsubscribes when callback throws", () => {
    const machine = new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });
    let notifications = 0;

    expect(() =>
      withMachineSubscription(
        machine,
        () => {
          notifications += 1;
        },
        () => {
          machine.dispatch(envelope({ type: "INGEST_CHANGED" }, { type: "system", id: "cron" }));
          throw new Error("boom");
        },
      ),
    ).toThrow("boom");

    machine.dispatch(envelope({ type: "MANUAL_SYNC_REQUESTED" }, { type: "system", id: "api" }));
    expect(notifications).toBe(1);
  });
});
