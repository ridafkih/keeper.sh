import { describe, expect, it } from "bun:test";
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
    });

    await runtime.dispatch({ holderId: "holder-1", type: "LOCK_ACQUIRED" });
    await runtime.dispatch({ type: "EXECUTION_STARTED" });
    const transition = await runtime.dispatch({
      eventsAdded: 3,
      eventsRemoved: 1,
      type: "EXECUTION_SUCCEEDED",
    });

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
    });

    await runtime.dispatch({ holderId: "holder-2", type: "LOCK_ACQUIRED" });
    await runtime.dispatch({ type: "EXECUTION_STARTED" });
    const transition = await runtime.dispatch({
      code: "timeout",
      nextAttemptAt: "2026-03-19T20:00:00.000Z",
      type: "EXECUTION_RETRYABLE_FAILED",
    });

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
    });

    await runtime.dispatch({ holderId: "holder-3", type: "LOCK_ACQUIRED" });
    await runtime.dispatch({ type: "EXECUTION_STARTED" });
    await runtime.releaseIfHeld();

    expect(released).toEqual(["holder-3"]);
  });
});
