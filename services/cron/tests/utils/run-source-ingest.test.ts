import { RESET_CALENDAR_BACKOFF_STATE, buildCalendarBackoffState } from "@keeper.sh/calendar";
import type { CalendarBackoffState } from "@keeper.sh/calendar";
import { describe, expect, it } from "vitest";
import { runSourceIngest } from "../../src/utils/run-source-ingest";
import type { SourceIngestAttempt, SourceIngestDependencies } from "../../src/utils/run-source-ingest";

const CALENDAR_ID = "788cfe5c-7f42-4257-9708-777053bbb083";
const ABORT_AFTER_MS = 60_000;

const buildCredentialError = (flag: string): Error => {
  const error = new Error("Token refresh failed (400): invalid_grant");
  Object.assign(error, { [flag]: true });
  return error;
};

interface Harness {
  applied: { calendarId: string; currentFailureCount: number }[];
  dependencies: SourceIngestDependencies;
  recorded: CalendarBackoffState[];
  resets: string[];
}

const createHarness = (attempt: SourceIngestAttempt | null): Harness => {
  const applied: Harness["applied"] = [];
  const recorded: CalendarBackoffState[] = [];
  const resets: string[] = [];

  return {
    applied,
    recorded,
    resets,
    dependencies: {
      acquireLease: () => Promise.resolve({
        isCurrent: () => Promise.resolve(true),
        release: () => Promise.resolve(),
      }),
      applyBackoff: (calendarId, observedAttempt) => {
        applied.push({ calendarId, currentFailureCount: observedAttempt.failureCount });
        return Promise.resolve(buildCalendarBackoffState(observedAttempt.failureCount));
      },
      readAttempt: () => Promise.resolve(attempt),
      recordBackoff: (state) => {
        recorded.push(state);
      },
      resetBackoff: (calendarId) => {
        resets.push(calendarId);
        return Promise.resolve();
      },
    },
  };
};

const runFailing = (harness: Harness, failure: Error): Promise<unknown> =>
  runSourceIngest(harness.dependencies, CALENDAR_ID, AbortSignal.timeout(ABORT_AFTER_MS), () => {
    throw failure;
  }).catch((error: unknown) => error);

describe("runSourceIngest", () => {
  it("schedules a later attempt after a credential failure instead of re-polling every tick", async () => {
    const credentialFailures = [
      buildCredentialError("oauthReauthRequired"),
      buildCredentialError("authRequired"),
      new Error("Collection query failed: 401 Unauthorized"),
    ];

    for (const failure of credentialFailures) {
      const harness = createHarness({ failureCount: 0, nextAttemptAt: null });

      expect(await runFailing(harness, failure)).toBe(failure);
      expect(harness.applied).toEqual([{ calendarId: CALENDAR_ID, currentFailureCount: 0 }]);
      expect(harness.recorded[0]?.nextAttemptAt).toBeInstanceOf(Date);
    }
  });

  it("schedules a later attempt after an ordinary provider failure", async () => {
    const harness = createHarness({ failureCount: 4, nextAttemptAt: null });
    const failure = new Error("Collection query failed: 404 Not Found");

    expect(await runFailing(harness, failure)).toBe(failure);
    expect(harness.applied).toEqual([{ calendarId: CALENDAR_ID, currentFailureCount: 4 }]);
    expect(harness.recorded[0]?.failureCount).toBe(5);
  });

  it("skips a calendar whose next attempt has not come due", async () => {
    const harness = createHarness({
      failureCount: 9,
      nextAttemptAt: new Date(Date.now() + ABORT_AFTER_MS),
    });

    const result = await runSourceIngest(
      harness.dependencies,
      CALENDAR_ID,
      AbortSignal.timeout(ABORT_AFTER_MS),
      () => {
        throw new Error("must not run");
      },
    );

    expect(result).toBeNull();
    expect(harness.applied).toEqual([]);
  });

  it("clears the backoff once a previously failing calendar succeeds", async () => {
    const harness = createHarness({
      failureCount: 3,
      nextAttemptAt: new Date(Date.now() - ABORT_AFTER_MS),
    });

    const result = await runSourceIngest(
      harness.dependencies,
      CALENDAR_ID,
      AbortSignal.timeout(ABORT_AFTER_MS),
      () => Promise.resolve("ingested"),
    );

    expect(result).toBe("ingested");
    expect(harness.resets).toEqual([CALENDAR_ID]);
    expect(harness.applied).toEqual([]);
    expect(RESET_CALENDAR_BACKOFF_STATE.nextAttemptAt).toBeNull();
  });
});
