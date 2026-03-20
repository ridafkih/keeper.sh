import { describe, expect, it } from "bun:test";
import { InMemoryCommandOutboxStore } from "@keeper.sh/machine-orchestration";
import type { DestinationExecutionCommand } from "@keeper.sh/state-machines";
import { createDestinationExecutionRuntime } from "./destination-execution-runtime";

describe("destination execution runtime", () => {
  it("releases lock and emits sync event on success", async () => {
    const released: string[] = [];
    const emitted: { added: number; removed: number }[] = [];
    const runtime = createDestinationExecutionRuntime({
      calendarId: "cal-1",
      failureCount: 0,
      handlers: {
        applyBackoff: () => Promise.resolve(),
        disableDestination: () => Promise.resolve(),
        emitSyncEvent: (eventsAdded, eventsRemoved) => {
          emitted.push({ added: eventsAdded, removed: eventsRemoved });
          return Promise.resolve();
        },
        releaseLock: (holderId) => {
          released.push(holderId);
          return Promise.resolve();
        },
      },
      outboxStore: new InMemoryCommandOutboxStore<DestinationExecutionCommand>(),
      onRuntimeEvent: () => Promise.resolve(),
    });

    await runtime.dispatch({ holderId: "holder-1", type: "LOCK_ACQUIRED" });
    await runtime.dispatch({ type: "EXECUTION_STARTED" });
    const result = await runtime.dispatch({
      eventsAdded: 3,
      eventsRemoved: 1,
      type: "EXECUTION_SUCCEEDED",
    });

    expect(result.outcome).toBe("TRANSITION_APPLIED");
    if (result.outcome !== "TRANSITION_APPLIED") {
      throw new Error("Expected transition to be applied");
    }
    const { transition } = result;
    expect(transition.state).toBe("completed");
    expect(released).toEqual(["holder-1"]);
    expect(emitted).toEqual([{ added: 3, removed: 1 }]);
  });

  it("applies backoff and releases lock on retryable failure", async () => {
    const released: string[] = [];
    const backoff: string[] = [];
    const runtime = createDestinationExecutionRuntime({
      calendarId: "cal-2",
      failureCount: 1,
      handlers: {
        applyBackoff: (nextAttemptAt) => {
          backoff.push(nextAttemptAt);
          return Promise.resolve();
        },
        disableDestination: () => Promise.resolve(),
        emitSyncEvent: () => Promise.resolve(),
        releaseLock: (holderId) => {
          released.push(holderId);
          return Promise.resolve();
        },
      },
      outboxStore: new InMemoryCommandOutboxStore<DestinationExecutionCommand>(),
      onRuntimeEvent: () => Promise.resolve(),
    });

    await runtime.dispatch({ holderId: "holder-2", type: "LOCK_ACQUIRED" });
    await runtime.dispatch({ type: "EXECUTION_STARTED" });
    const result = await runtime.dispatch({
      code: "timeout",
      nextAttemptAt: "2026-03-19T20:00:00.000Z",
      type: "EXECUTION_RETRYABLE_FAILED",
    });

    expect(result.outcome).toBe("TRANSITION_APPLIED");
    if (result.outcome !== "TRANSITION_APPLIED") {
      throw new Error("Expected transition to be applied");
    }
    const { transition } = result;
    expect(transition.state).toBe("backoff_scheduled");
    expect(backoff).toEqual(["2026-03-19T20:00:00.000Z"]);
    expect(released).toEqual(["holder-2"]);
  });

  it("releases held lock on unexpected failure path", async () => {
    const released: string[] = [];
    const runtime = createDestinationExecutionRuntime({
      calendarId: "cal-3",
      failureCount: 0,
      handlers: {
        applyBackoff: () => Promise.resolve(),
        disableDestination: () => Promise.resolve(),
        emitSyncEvent: () => Promise.resolve(),
        releaseLock: (holderId) => {
          released.push(holderId);
          return Promise.resolve();
        },
      },
      outboxStore: new InMemoryCommandOutboxStore<DestinationExecutionCommand>(),
      onRuntimeEvent: () => Promise.resolve(),
    });

    await runtime.dispatch({ holderId: "holder-3", type: "LOCK_ACQUIRED" });
    await runtime.dispatch({ type: "EXECUTION_STARTED" });
    await runtime.releaseIfHeld();

    expect(released).toEqual(["holder-3"]);
  });

  it("emits runtime processed events", async () => {
    const processed: string[] = [];
    const runtime = createDestinationExecutionRuntime({
      calendarId: "cal-4",
      failureCount: 0,
      handlers: {
        applyBackoff: () => Promise.resolve(),
        disableDestination: () => Promise.resolve(),
        emitSyncEvent: () => Promise.resolve(),
        releaseLock: () => Promise.resolve(),
      },
      outboxStore: new InMemoryCommandOutboxStore<DestinationExecutionCommand>(),
      onRuntimeEvent: (event) => {
        processed.push(event.envelope.event.type);
        return Promise.resolve();
      },
    });

    await runtime.dispatch({ holderId: "holder-4", type: "LOCK_ACQUIRED" });
    await runtime.dispatch({ type: "EXECUTION_STARTED" });

    expect(processed).toEqual(["LOCK_ACQUIRED", "EXECUTION_STARTED"]);
  });

  it("does not share dedup state across runtime instances", async () => {
    const firstRuntime = createDestinationExecutionRuntime({
      calendarId: "cal-shared",
      failureCount: 0,
      handlers: {
        applyBackoff: () => Promise.resolve(),
        disableDestination: () => Promise.resolve(),
        emitSyncEvent: () => Promise.resolve(),
        releaseLock: () => Promise.resolve(),
      },
      outboxStore: new InMemoryCommandOutboxStore<DestinationExecutionCommand>(),
      onRuntimeEvent: () => Promise.resolve(),
    });
    const secondRuntime = createDestinationExecutionRuntime({
      calendarId: "cal-shared",
      failureCount: 0,
      handlers: {
        applyBackoff: () => Promise.resolve(),
        disableDestination: () => Promise.resolve(),
        emitSyncEvent: () => Promise.resolve(),
        releaseLock: () => Promise.resolve(),
      },
      outboxStore: new InMemoryCommandOutboxStore<DestinationExecutionCommand>(),
      onRuntimeEvent: () => Promise.resolve(),
    });

    const firstResult = await firstRuntime.dispatch({
      holderId: "holder-a",
      type: "LOCK_ACQUIRED",
    });
    const secondResult = await secondRuntime.dispatch({
      holderId: "holder-b",
      type: "LOCK_ACQUIRED",
    });

    expect(firstResult.outcome).toBe("TRANSITION_APPLIED");
    expect(secondResult.outcome).toBe("TRANSITION_APPLIED");
    if (firstResult.outcome !== "TRANSITION_APPLIED") {
      throw new Error("Expected first transition to be applied");
    }
    if (secondResult.outcome !== "TRANSITION_APPLIED") {
      throw new Error("Expected second transition to be applied");
    }
    expect(firstResult.transition.state).toBe("locked");
    expect(secondResult.transition.state).toBe("locked");
  });
});
