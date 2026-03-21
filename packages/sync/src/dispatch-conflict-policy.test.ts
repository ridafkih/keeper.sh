import { describe, expect, it } from "bun:test";
import {
  DispatchConflictCode,
  handleDispatchConflict,
} from "./dispatch-conflict-policy";

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
      conflictCode: DispatchConflictCode.LOCK_ACQUIRED,
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
      conflictCode: DispatchConflictCode.EXECUTION_STARTED,
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
      conflictCode: DispatchConflictCode.EXECUTION_SUCCEEDED,
      notifyCalendarFailed: (failure) => {
        failures.push(failure.error);
        return Promise.resolve();
      },
    });

    expect(duplicateHandled).toBe(true);
    expect(conflictHandled).toBe(true);
    expect(releaseCalls).toBe(2);
    expect(failures).toEqual([
      DispatchConflictCode.EXECUTION_STARTED,
      DispatchConflictCode.EXECUTION_SUCCEEDED,
    ]);
  });

  it("handles all caller conflict policy codes", async () => {
    const conflictCodes = [
      DispatchConflictCode.LOCK_ACQUIRED,
      DispatchConflictCode.EXECUTION_STARTED,
      DispatchConflictCode.PROVIDER_RESOLUTION_FAILED,
      DispatchConflictCode.INVALIDATION_DETECTED,
      DispatchConflictCode.EXECUTION_SUCCEEDED,
      DispatchConflictCode.EXECUTION_FAILED,
    ];

    for (const conflictCode of conflictCodes) {
      let releaseCalls = 0;
      const failures: string[] = [];
      const handled = await handleDispatchConflict({
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
        conflictCode,
        notifyCalendarFailed: (failure) => {
          failures.push(failure.error);
          return Promise.resolve();
        },
      });

      expect(handled).toBe(true);
      expect(releaseCalls).toBe(1);
      expect(failures).toEqual([conflictCode]);
    }
  });

  it("fails fast when conflict policy code is invalid", async () => {
    await expect(
      handleDispatchConflict({
        result: {
          aggregateId: "cal-1",
          envelopeId: "env-1",
          outcome: "CONFLICT_DETECTED",
        },
        runtime: {
          releaseIfHeld: () => Promise.resolve(),
        },
        destination: {
          accountId: "acc-1",
          calendarId: "cal-1",
          provider: "google",
          userId: "user-1",
        },
        startedAtMs: Date.now(),
        conflictCode: "machine_conflict_invalid" as DispatchConflictCode,
        notifyCalendarFailed: () => Promise.resolve(),
      }),
    ).rejects.toThrow("Unknown dispatch conflict code");
  });
});
