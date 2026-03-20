import { describe, expect, it } from "bun:test";
import { handleDispatchConflict } from "./dispatch-conflict-policy";

describe("handleDispatchConflict", () => {
  it("returns false when transition applied", async () => {
    let releaseCalls = 0;
    const failures: string[] = [];
    const handled = await handleDispatchConflict({
      result: {
        outcome: "TRANSITION_APPLIED",
        transition: {
          commands: [],
          context: { calendarId: "cal-1", failureCount: 0 },
          outputs: [],
          state: "ready",
        },
      },
      runtime: {
        releaseIfHeld: () => {
          releaseCalls += 1;
          return Promise.resolve();
        },
      },
      destination: {
        accountId: "acc-1",
        calendarId: "cal-1",
        provider: "google",
        userId: "user-1",
      },
      startedAtMs: Date.now(),
      conflictCode: "machine_conflict_lock_acquired",
      notifyCalendarFailed: (failure) => {
        failures.push(failure.error);
        return Promise.resolve();
      },
    });

    expect(handled).toBe(false);
    expect(releaseCalls).toBe(0);
    expect(failures).toEqual([]);
  });

  it("handles duplicate/conflict outcomes by releasing lock and notifying failure", async () => {
    let releaseCalls = 0;
    const failures: string[] = [];
    const duplicateHandled = await handleDispatchConflict({
      result: { outcome: "DUPLICATE_IGNORED" },
      runtime: {
        releaseIfHeld: () => {
          releaseCalls += 1;
          return Promise.resolve();
        },
      },
      destination: {
        accountId: "acc-1",
        calendarId: "cal-1",
        provider: "google",
        userId: "user-1",
      },
      startedAtMs: Date.now(),
      conflictCode: "machine_conflict_execution_started",
      notifyCalendarFailed: (failure) => {
        failures.push(failure.error);
        return Promise.resolve();
      },
    });

    const conflictHandled = await handleDispatchConflict({
      result: {
        aggregateId: "cal-1",
        envelopeId: "env-1",
        outcome: "CONFLICT_DETECTED",
      },
      runtime: {
        releaseIfHeld: () => {
          releaseCalls += 1;
          return Promise.resolve();
        },
      },
      destination: {
        accountId: "acc-1",
        calendarId: "cal-1",
        provider: "google",
        userId: "user-1",
      },
      startedAtMs: Date.now(),
      conflictCode: "machine_conflict_execution_succeeded",
      notifyCalendarFailed: (failure) => {
        failures.push(failure.error);
        return Promise.resolve();
      },
    });

    expect(duplicateHandled).toBe(true);
    expect(conflictHandled).toBe(true);
    expect(releaseCalls).toBe(2);
    expect(failures).toEqual([
      "machine_conflict_execution_started",
      "machine_conflict_execution_succeeded",
    ]);
  });
});
