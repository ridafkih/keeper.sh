import { describe, expect, it } from "bun:test";
import type {
  EventEnvelope,
  MachineSnapshot,
  MachineTransitionResult,
} from "@keeper.sh/state-machines";
import {
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  MachineConcurrencyError,
  MachineRuntimeDriver,
} from "./machine-runtime-driver";
import type { RuntimeProcessEvent } from "./machine-runtime-driver";

type TestState = "idle" | "active";
interface TestContext {
  activeId?: string;
}
interface TestEvent {
  type: "ACTIVATE";
  id: string;
}
interface TestCommand {
  type: "DO_WORK";
  id: string;
}

interface TestMachine {
  restore: (snapshot: MachineSnapshot<TestState, TestContext>) => void;
  getSnapshot: () => MachineSnapshot<TestState, TestContext>;
  dispatch: (
    envelope: EventEnvelope<TestEvent>,
  ) => MachineTransitionResult<TestState, TestContext, TestCommand, never>;
}

const buildEnvelope = (id: string, entityId: string): EventEnvelope<TestEvent> => ({
  actor: { id: "svc-test", type: "system" },
  event: { id: entityId, type: "ACTIVATE" },
  id,
  occurredAt: "2026-03-19T19:00:00.000Z",
});

class FakeMachine implements TestMachine {
  private snapshot: MachineSnapshot<TestState, TestContext> = {
    context: {},
    state: "idle",
  };

  restore(snapshot: MachineSnapshot<TestState, TestContext>): void {
    this.snapshot = snapshot;
  }

  getSnapshot(): MachineSnapshot<TestState, TestContext> {
    return this.snapshot;
  }

  dispatch(
    envelope: EventEnvelope<TestEvent>,
  ): MachineTransitionResult<TestState, TestContext, TestCommand, never> {
    this.snapshot = {
      context: { activeId: envelope.event.id },
      state: "active",
    };
    return {
      commands: [{ id: envelope.event.id, type: "DO_WORK" }],
      context: this.snapshot.context,
      outputs: [],
      state: this.snapshot.state,
    };
  }
}

describe("MachineRuntimeDriver", () => {
  it("processes envelope once and persists snapshot", async () => {
    const snapshotStore = new InMemorySnapshotStore<TestState, TestContext>();
    const envelopeStore = new InMemoryEnvelopeStore();
    await snapshotStore.initialize("aggregate-1", { context: {}, state: "idle" });

    const executed: TestCommand[] = [];
    const events: RuntimeProcessEvent<TestState, TestContext, TestEvent, TestCommand, never>[] = [];
    const driver = new MachineRuntimeDriver<
      TestState,
      TestContext,
      TestEvent,
      TestCommand,
      never
    >({
      aggregateId: "aggregate-1",
      commandBus: {
        execute: (command) => {
          executed.push(command);
          return Promise.resolve();
        },
      },
      eventSink: {
        onProcessed: (event) => {
          events.push(event);
        },
      },
      envelopeStore,
      machine: new FakeMachine(),
      snapshotStore,
    });

    const result = await driver.process(buildEnvelope("env-1", "entity-1"));
    expect(result.duplicate).toBe(false);
    expect(result.transition?.state).toBe("active");
    expect(executed).toEqual([{ id: "entity-1", type: "DO_WORK" }]);

    const current = await snapshotStore.read("aggregate-1");
    expect(current?.snapshot).toEqual({
      context: { activeId: "entity-1" },
      state: "active",
    });
    expect(await envelopeStore.hasProcessed("aggregate-1", "env-1")).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.duplicate).toBe(false);
    expect(events[0]?.version).toBe(1);
    expect(events[0]?.transition?.state).toBe("active");
  });

  it("does not re-execute duplicate envelope", async () => {
    const snapshotStore = new InMemorySnapshotStore<TestState, TestContext>();
    const envelopeStore = new InMemoryEnvelopeStore();
    await snapshotStore.initialize("aggregate-2", { context: {}, state: "idle" });

    const executed: TestCommand[] = [];
    const events: RuntimeProcessEvent<TestState, TestContext, TestEvent, TestCommand, never>[] = [];
    const driver = new MachineRuntimeDriver<
      TestState,
      TestContext,
      TestEvent,
      TestCommand,
      never
    >({
      aggregateId: "aggregate-2",
      commandBus: {
        execute: (command) => {
          executed.push(command);
          return Promise.resolve();
        },
      },
      eventSink: {
        onProcessed: (event) => {
          events.push(event);
        },
      },
      envelopeStore,
      machine: new FakeMachine(),
      snapshotStore,
    });

    await driver.process(buildEnvelope("env-2", "entity-2"));
    const duplicate = await driver.process(buildEnvelope("env-2", "entity-2"));

    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.transition).toBeUndefined();
    expect(executed).toEqual([{ id: "entity-2", type: "DO_WORK" }]);
    expect(events).toHaveLength(2);
    expect(events[1]?.duplicate).toBe(true);
  });

  it("fails on compare-and-set conflict and does not mark processed", async () => {
    const snapshotStore = new InMemorySnapshotStore<TestState, TestContext>();
    const envelopeStore = new InMemoryEnvelopeStore();
    await snapshotStore.initialize("aggregate-3", { context: {}, state: "idle" });

    const driver = new MachineRuntimeDriver<
      TestState,
      TestContext,
      TestEvent,
      TestCommand,
      never
    >({
      aggregateId: "aggregate-3",
      commandBus: {
        execute: async () => {
          await snapshotStore.forceBumpVersion("aggregate-3");
        },
      },
      eventSink: {
        onProcessed: () => Promise.resolve(),
      },
      envelopeStore,
      machine: new FakeMachine(),
      snapshotStore,
    });

    await expect(driver.process(buildEnvelope("env-3", "entity-3"))).rejects.toBeInstanceOf(
      MachineConcurrencyError,
    );
    expect(await envelopeStore.hasProcessed("aggregate-3", "env-3")).toBe(false);
  });

  it("does not persist snapshot when command execution fails", async () => {
    const snapshotStore = new InMemorySnapshotStore<TestState, TestContext>();
    const envelopeStore = new InMemoryEnvelopeStore();
    await snapshotStore.initialize("aggregate-4", { context: {}, state: "idle" });

    const driver = new MachineRuntimeDriver<
      TestState,
      TestContext,
      TestEvent,
      TestCommand,
      never
    >({
      aggregateId: "aggregate-4",
      commandBus: {
        execute: () => Promise.reject(new Error("command failure")),
      },
      eventSink: {
        onProcessed: () => Promise.resolve(),
      },
      envelopeStore,
      machine: new FakeMachine(),
      snapshotStore,
    });

    await expect(driver.process(buildEnvelope("env-4", "entity-4"))).rejects.toThrow(
      "command failure",
    );
    const current = await snapshotStore.read("aggregate-4");
    expect(current?.snapshot).toEqual({ context: {}, state: "idle" });
    expect(await envelopeStore.hasProcessed("aggregate-4", "env-4")).toBe(false);
  });
});
