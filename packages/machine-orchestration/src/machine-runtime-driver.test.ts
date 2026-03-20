import { describe, expect, it } from "bun:test";
import type {
  EventEnvelope,
  MachineSnapshot,
  MachineTransitionResult,
} from "@keeper.sh/state-machines";
import {
  InMemoryCommandOutboxStore,
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  MachineConflictDetectedError,
  MachineRuntimeDriver,
  RedisCommandOutboxStore,
  isMachineConflictDetectedError,
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
  it("detects typed machine conflict errors", () => {
    const conflictError = new MachineConflictDetectedError("aggregate-0", "env-0");
    expect(isMachineConflictDetectedError(conflictError)).toBe(true);
    expect(isMachineConflictDetectedError(new Error("nope"))).toBe(false);
    expect(isMachineConflictDetectedError("bad")).toBe(false);
  });

  it("processes envelope once and persists snapshot", async () => {
    const snapshotStore = new InMemorySnapshotStore<TestState, TestContext>();
    const envelopeStore = new InMemoryEnvelopeStore();
    const outboxStore = new InMemoryCommandOutboxStore<TestCommand>();
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
      outboxStore,
      machine: new FakeMachine(),
      snapshotStore,
    });

    const result = await driver.process(buildEnvelope("env-1", "entity-1"));
    expect(result.outcome).toBe("APPLIED");
    expect(result.transition?.state).toBe("active");
    expect(executed).toEqual([]);
    await driver.drainOutbox();
    expect(executed).toEqual([{ id: "entity-1", type: "DO_WORK" }]);

    const current = await snapshotStore.read("aggregate-1");
    expect(current?.snapshot).toEqual({
      context: { activeId: "entity-1" },
      state: "active",
    });
    expect(await envelopeStore.hasProcessed("aggregate-1", "env-1")).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe("APPLIED");
    expect(events[0]?.version).toBe(1);
    expect(events[0]?.transition?.state).toBe("active");
  });

  it("does not re-execute duplicate envelope", async () => {
    const snapshotStore = new InMemorySnapshotStore<TestState, TestContext>();
    const envelopeStore = new InMemoryEnvelopeStore();
    const outboxStore = new InMemoryCommandOutboxStore<TestCommand>();
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
      outboxStore,
      machine: new FakeMachine(),
      snapshotStore,
    });

    await driver.process(buildEnvelope("env-2", "entity-2"));
    const duplicate = await driver.process(buildEnvelope("env-2", "entity-2"));

    expect(duplicate.outcome).toBe("DUPLICATE_IGNORED");
    expect(duplicate.transition).toBeUndefined();
    expect(executed).toEqual([]);
    await driver.drainOutbox();
    expect(executed).toEqual([{ id: "entity-2", type: "DO_WORK" }]);
    expect(events).toHaveLength(2);
    expect(events[1]?.outcome).toBe("DUPLICATE_IGNORED");
  });

  it("returns conflict outcome on compare-and-set conflict and does not mark processed", async () => {
    const envelopeStore = new InMemoryEnvelopeStore();
    const outboxStore = new InMemoryCommandOutboxStore<TestCommand>();
    const events: RuntimeProcessEvent<TestState, TestContext, TestEvent, TestCommand, never>[] = [];
    const snapshotStore = {
      compareAndSet: () => Promise.resolve(null),
      read: () =>
        Promise.resolve({
          snapshot: { context: {}, state: "idle" } as MachineSnapshot<TestState, TestContext>,
          version: 0,
        }),
    };

    const driver = new MachineRuntimeDriver<
      TestState,
      TestContext,
      TestEvent,
      TestCommand,
      never
    >({
      aggregateId: "aggregate-3",
      commandBus: {
        execute: () => Promise.resolve(),
      },
      eventSink: {
        onProcessed: (event) => {
          events.push(event);
        },
      },
      envelopeStore,
      outboxStore,
      machine: new FakeMachine(),
      snapshotStore,
    });

    const result = await driver.process(buildEnvelope("env-3", "entity-3"));
    expect(result.outcome).toBe("CONFLICT_DETECTED");
    expect(result.transition).toBeUndefined();
    expect(await envelopeStore.hasProcessed("aggregate-3", "env-3")).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe("CONFLICT_DETECTED");
  });

  it("does not persist snapshot when command execution fails", async () => {
    const snapshotStore = new InMemorySnapshotStore<TestState, TestContext>();
    const envelopeStore = new InMemoryEnvelopeStore();
    const outboxStore = new InMemoryCommandOutboxStore<TestCommand>();
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
      outboxStore,
      machine: new FakeMachine(),
      snapshotStore,
    });

    const processResult = await driver.process(buildEnvelope("env-4", "entity-4"));
    expect(processResult.outcome).toBe("APPLIED");
    await expect(driver.drainOutbox()).rejects.toThrow(
      "command failure",
    );
    const current = await snapshotStore.read("aggregate-4");
    expect(current?.snapshot).toEqual({ context: { activeId: "entity-4" }, state: "active" });
    expect(await envelopeStore.hasProcessed("aggregate-4", "env-4")).toBe(true);
  });

  it("serializes adversarial parallel dispatch on same aggregate", async () => {
    const snapshotStore = new InMemorySnapshotStore<TestState, TestContext>();
    const envelopeStore = new InMemoryEnvelopeStore();
    const outboxStore = new InMemoryCommandOutboxStore<TestCommand>();
    await snapshotStore.initialize("aggregate-5", { context: {}, state: "idle" });

    const events: RuntimeProcessEvent<TestState, TestContext, TestEvent, TestCommand, never>[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const commandBus = {
      execute: async () => {
        inFlight += 1;
        if (inFlight > maxInFlight) {
          maxInFlight = inFlight;
        }
        await Promise.resolve();
        inFlight -= 1;
      },
    };

    const buildDriver = (): MachineRuntimeDriver<TestState, TestContext, TestEvent, TestCommand, never> =>
      new MachineRuntimeDriver<TestState, TestContext, TestEvent, TestCommand, never>({
        aggregateId: "aggregate-5",
        commandBus,
        eventSink: {
          onProcessed: (event) => {
            events.push(event);
          },
        },
        envelopeStore,
        outboxStore,
        machine: new FakeMachine(),
        snapshotStore,
      });

    const driverA = buildDriver();
    const driverB = buildDriver();

    const [first, second] = await Promise.all([
      driverA.process(buildEnvelope("env-5a", "entity-5a")),
      driverB.process(buildEnvelope("env-5b", "entity-5b")),
    ]);
    await driverA.drainOutbox();

    expect(first.outcome).toBe("APPLIED");
    expect(second.outcome).toBe("APPLIED");
    expect(await envelopeStore.hasProcessed("aggregate-5", "env-5a")).toBe(true);
    expect(await envelopeStore.hasProcessed("aggregate-5", "env-5b")).toBe(true);
    expect(maxInFlight).toBe(1);
    expect(events).toHaveLength(2);
    const appliedCount = events.filter((event) => event.outcome === "APPLIED").length;
    const conflictCount = events.filter((event) => event.outcome === "CONFLICT_DETECTED").length;
    expect(appliedCount).toBe(2);
    expect(conflictCount).toBe(0);
    await driverA.drainOutbox();
    const remaining = await outboxStore.readNext("aggregate-5");
    expect(remaining).toBeNull();
  });
});

describe("RedisCommandOutboxStore", () => {
  it("persists records and supports resumable drain state", async () => {
    const strings = new Map<string, string>();
    const hashes = new Map<string, Record<string, string>>();
    const lists = new Map<string, string[]>();
    const sets = new Map<string, Set<string>>();
    const redis = {
      del: (key: string) => {
        const hadHash = hashes.delete(key);
        const hadString = strings.delete(key);
        return Promise.resolve(Number(hadHash || hadString));
      },
      exists: (key: string) => Promise.resolve(Number(hashes.has(key) || strings.has(key))),
      hgetall: (key: string) => Promise.resolve(hashes.get(key) ?? {}),
      hincrby: (key: string, field: string, increment: number) => {
        const current = hashes.get(key) ?? {};
        const value = Number.parseInt(current[field] ?? "0", 10) + increment;
        current[field] = String(value);
        hashes.set(key, current);
        return Promise.resolve(value);
      },
      hset: (key: string, data: Record<string, string>) => {
        hashes.set(key, { ...hashes.get(key), ...data });
        return Promise.resolve(Object.keys(data).length);
      },
      lindex: (key: string, index: number) =>
        Promise.resolve((lists.get(key) ?? [])[index] ?? null),
      llen: (key: string) => Promise.resolve((lists.get(key) ?? []).length),
      lpop: (key: string) => {
        const entries = lists.get(key) ?? [];
        const value = entries.shift() ?? null;
        lists.set(key, entries);
        return Promise.resolve(value);
      },
      lrem: (key: string, _count: number, value: string) => {
        const entries = lists.get(key) ?? [];
        const nextEntries = entries.filter((entry) => entry !== value);
        lists.set(key, nextEntries);
        return Promise.resolve(entries.length - nextEntries.length);
      },
      rpush: (key: string, value: string) => {
        const entries = lists.get(key) ?? [];
        entries.push(value);
        lists.set(key, entries);
        return Promise.resolve(entries.length);
      },
      sadd: (key: string, value: string) => {
        const values = sets.get(key) ?? new Set<string>();
        const { size } = values;
        values.add(value);
        sets.set(key, values);
        return Promise.resolve(Number(values.size !== size));
      },
      smembers: (key: string) => Promise.resolve([...(sets.get(key) ?? new Set<string>()).values()]),
      srem: (key: string, value: string) => {
        const values = sets.get(key) ?? new Set<string>();
        const deleted = values.delete(value);
        sets.set(key, values);
        return Promise.resolve(Number(deleted));
      },
    };

    const store = new RedisCommandOutboxStore<TestCommand>({
      keyPrefix: "test:outbox",
      redis,
    });

    await store.enqueue({
      aggregateId: "agg-1",
      commands: [{ id: "x", type: "DO_WORK" }],
      envelopeId: "env-1",
      nextCommandIndex: 0,
    });

    const first = await store.readNext("agg-1");
    expect(first?.envelopeId).toBe("env-1");
    expect(first?.nextCommandIndex).toBe(0);
    expect(await store.listAggregates()).toEqual(["agg-1"]);

    await store.advanceNextCommand("agg-1", "env-1");
    const second = await store.readNext("agg-1");
    expect(second?.nextCommandIndex).toBe(1);

    await store.complete("agg-1", "env-1");
    expect(await store.readNext("agg-1")).toBeNull();
    expect(await store.listAggregates()).toEqual([]);
  });
});

describe("MachineRuntimeDriver outbox drain helpers", () => {
  it("drains an aggregate outbox through static helper", async () => {
    const executed: string[] = [];
    const outboxStore = new InMemoryCommandOutboxStore<TestCommand>();
    await outboxStore.enqueue({
      aggregateId: "aggregate-static",
      commands: [{ id: "command-1", type: "DO_WORK" }],
      envelopeId: "env-static",
      nextCommandIndex: 0,
    });

    await MachineRuntimeDriver.drainAggregateOutbox({
      aggregateId: "aggregate-static",
      commandBus: {
        execute: (command) => {
          executed.push(command.id);
          return Promise.resolve();
        },
      },
      outboxStore,
    });

    expect(executed).toEqual(["command-1"]);
    expect(await outboxStore.readNext("aggregate-static")).toBeNull();
  });
});
