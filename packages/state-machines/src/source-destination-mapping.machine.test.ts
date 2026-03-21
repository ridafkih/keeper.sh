import { describe, expect, test } from "bun:test";
import { createEventEnvelope } from "./core/event-envelope";
import { TransitionPolicy } from "./core/transition-policy";
import {
  SourceDestinationMappingEventType,
  SourceDestinationMappingStateMachine,
} from "./source-destination-mapping.machine";

const createEnvelope = <TEvent>(id: string, event: TEvent) =>
  createEventEnvelope(
    event,
    { id: "test", type: "system" },
    { id, occurredAt: "2026-03-21T10:00:00.000Z" },
  );

describe("SourceDestinationMappingStateMachine", () => {
  test("emits sync request when mappings change", () => {
    const machine = new SourceDestinationMappingStateMachine(
      { aggregateId: "user-1:source:calendar-1" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );

    const transition = machine.dispatch(createEnvelope("1", {
      changed: true,
      type: SourceDestinationMappingEventType.UPDATE_APPLIED,
    }));

    expect(transition.state).toBe("completed");
    expect(transition.commands).toEqual([{ type: "REQUEST_SYNC" }]);
    expect(transition.outputs).toEqual([
      { type: "MAPPINGS_UPDATED", changed: true },
      { type: "SYNC_REQUESTED" },
    ]);
  });

  test("does not request sync when mappings are unchanged", () => {
    const machine = new SourceDestinationMappingStateMachine(
      { aggregateId: "user-1:destination:calendar-1" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );

    const transition = machine.dispatch(createEnvelope("1", {
      changed: false,
      type: SourceDestinationMappingEventType.UPDATE_APPLIED,
    }));

    expect(transition.state).toBe("completed");
    expect(transition.commands).toEqual([]);
    expect(transition.outputs).toEqual([{ type: "MAPPINGS_UPDATED", changed: false }]);
  });

  test("emits limit rejection output", () => {
    const machine = new SourceDestinationMappingStateMachine(
      { aggregateId: "aggregate-1" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );

    const transition = machine.dispatch(createEnvelope("1", {
      type: SourceDestinationMappingEventType.LIMIT_REJECTED,
    }));

    expect(transition.state).toBe("rejected");
    expect(transition.outputs).toEqual([{ type: "MAPPING_LIMIT_REJECTED" }]);
  });

  test("rejects out-of-order replay in strict mode", () => {
    const machine = new SourceDestinationMappingStateMachine(
      { aggregateId: "aggregate-1" },
      { transitionPolicy: TransitionPolicy.REJECT },
    );

    machine.dispatch(createEnvelope("1", {
      changed: false,
      type: SourceDestinationMappingEventType.UPDATE_APPLIED,
    }));

    expect(() =>
      machine.dispatch(createEnvelope("2", {
        type: SourceDestinationMappingEventType.INVALID_SET_REJECTED,
      })),
    ).toThrow("Transition rejected by policy");
  });
});
