import { describe, expect, it } from "bun:test";
import {
  InMemoryCommandOutboxStore,
  RuntimeInvariantViolationError,
} from "@keeper.sh/machine-orchestration";
import type { DestinationExecutionCommand } from "@keeper.sh/state-machines";
import type { DestinationExecutionEvent, EventEnvelope } from "@keeper.sh/state-machines";
import { createDestinationExecutionRuntime } from "./destination-execution-runtime";

const createEnvelopeFactory = (
  calendarId: string,
): ((event: DestinationExecutionEvent) => EventEnvelope<DestinationExecutionEvent>) => {
  let sequence = 0;
  return (event) => {
    sequence += 1;
    return {
      actor: { id: "test-sync-runtime", type: "system" },
      event,
      id: `${calendarId}:${sequence}:${event.type}`,
      occurredAt: `2026-03-20T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    };
  };
};

describe("destination execution runtime", () => {
  it("releases lock and emits sync event on success", async () => {
    const released: string[] = [];
    const emitted: { added: number; removed: number }[] = [];
    const runtime = createDestinationExecutionRuntime({
      calendarId: "cal-1",
      createEnvelope: createEnvelopeFactory("cal-1"),
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
      createEnvelope: createEnvelopeFactory("cal-2"),
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
      createEnvelope: createEnvelopeFactory("cal-3"),
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
      createEnvelope: createEnvelopeFactory("cal-4"),
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
      createEnvelope: createEnvelopeFactory("cal-shared-first"),
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
      createEnvelope: createEnvelopeFactory("cal-shared-second"),
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

  it("fails fast when envelope metadata is invalid", async () => {
    const runtime = createDestinationExecutionRuntime({
      calendarId: "cal-invalid",
      createEnvelope: (event) => ({
        actor: { id: "test-sync-runtime", type: "system" },
        event,
        id: "",
        occurredAt: "invalid-time",
      }),
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

    await expect(
      runtime.dispatch({ holderId: "holder-invalid", type: "LOCK_ACQUIRED" }),
    ).rejects.toBeInstanceOf(RuntimeInvariantViolationError);
    await expect(
      runtime.dispatch({ holderId: "holder-invalid", type: "LOCK_ACQUIRED" }),
    ).rejects.toMatchObject({
      code: "DESTINATION_EXECUTION_ENVELOPE_ID_REQUIRED",
      surface: "destination-execution-runtime",
    });
  });

  it("handles adversarial parallel terminal dispatch without duplicate side effects", async () => {
    const released: string[] = [];
    const emitted: string[] = [];
    const runtime = createDestinationExecutionRuntime({
      calendarId: "cal-parallel",
      createEnvelope: (event) => ({
        actor: { id: "test-sync-runtime", type: "system" },
        event,
        id: `cal-parallel:${event.type}`,
        occurredAt: "2026-03-20T00:00:00.000Z",
      }),
      failureCount: 0,
      handlers: {
        applyBackoff: () => Promise.resolve(),
        disableDestination: () => Promise.resolve(),
        emitSyncEvent: (eventsAdded, eventsRemoved) => {
          emitted.push(`${eventsAdded}:${eventsRemoved}`);
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

    await runtime.dispatch({ holderId: "holder-parallel", type: "LOCK_ACQUIRED" });
    await runtime.dispatch({ type: "EXECUTION_STARTED" });

    const [first, second] = await Promise.all([
      runtime.dispatch({
        eventsAdded: 2,
        eventsRemoved: 1,
        type: "EXECUTION_SUCCEEDED",
      }),
      runtime.dispatch({
        eventsAdded: 2,
        eventsRemoved: 1,
        type: "EXECUTION_SUCCEEDED",
      }),
    ]);

    const outcomes = [first.outcome, second.outcome];
    expect(outcomes).toContain("TRANSITION_APPLIED");
    expect(
      outcomes.includes("DUPLICATE_IGNORED") || outcomes.includes("CONFLICT_DETECTED"),
    ).toBe(true);
    expect(released).toEqual(["holder-parallel"]);
    expect(emitted).toEqual(["2:1"]);
  });
});
