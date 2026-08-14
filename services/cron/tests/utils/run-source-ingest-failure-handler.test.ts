import { buildCalendarBackoffState } from "@keeper.sh/calendar";
import type { CalendarBackoffState } from "@keeper.sh/calendar";
import { describe, expect, it } from "vitest";
import { runSourceIngest } from "../../src/utils/run-source-ingest";
import type { SourceIngestAttempt, SourceIngestDependencies } from "../../src/utils/run-source-ingest";

const CALENDAR_ID = "b1f6c0d4-7a52-4c8e-9f31-5d0a8b2e6c74";
const ABORT_AFTER_MS = 60_000;

interface Harness {
  attempt: SourceIngestAttempt;
  dependencies: SourceIngestDependencies;
  handled: unknown[];
  recorded: CalendarBackoffState[];
}

interface HarnessOptions {
  attempt: SourceIngestAttempt;
  winsCompareAndSet?: boolean;
}

const isSameAttempt = (left: SourceIngestAttempt, right: SourceIngestAttempt): boolean =>
  left.failureCount === right.failureCount
  && (left.nextAttemptAt?.getTime() ?? null) === (right.nextAttemptAt?.getTime() ?? null);

const createHarness = (options: HarnessOptions): Harness => {
  const harness: Harness = {
    attempt: options.attempt,
    dependencies: {} as SourceIngestDependencies,
    handled: [],
    recorded: [],
  };

  harness.dependencies = {
    acquireLease: () => Promise.resolve({
      isCurrent: () => Promise.resolve(true),
      release: () => Promise.resolve(),
    }),
    applyBackoff: (_calendarId, observedAttempt) => {
      if (options.winsCompareAndSet === false || !isSameAttempt(harness.attempt, observedAttempt)) {
        return Promise.resolve(null);
      }
      return Promise.resolve(buildCalendarBackoffState(observedAttempt.failureCount));
    },
    readAttempt: () => Promise.resolve(harness.attempt),
    recordBackoff: (state) => {
      harness.recorded.push(state);
    },
    resetBackoff: () => Promise.resolve(),
  };

  return harness;
};

const credentialError = (): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), {
    oauthReauthRequired: true,
  });

const runFailing = (
  harness: Harness,
  failure: Error,
  onSettledFailure: (error: unknown) => Promise<void> | void,
): Promise<unknown> =>
  runSourceIngest(
    harness.dependencies,
    CALENDAR_ID,
    AbortSignal.timeout(ABORT_AFTER_MS),
    () => {
      throw failure;
    },
    { onSettledFailure },
  ).catch((error: unknown) => error);

const recordHandled = (harness: Harness) => (error: unknown): void => {
  harness.handled.push(error);
};

describe("the settled-failure handler", () => {
  it("runs with the ingest failure once the attempt has been backed off", async () => {
    const harness = createHarness({ attempt: { failureCount: 0, nextAttemptAt: null } });
    const failure = credentialError();

    expect(await runFailing(harness, failure, recordHandled(harness))).toBe(failure);
    expect(harness.handled).toEqual([failure]);
  });

  it("does not run when a reconnect replaced the attempt state under the run", async () => {
    const harness = createHarness({
      attempt: { failureCount: 3, nextAttemptAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    const failure = credentialError();

    const outcome = await runSourceIngest(
      harness.dependencies,
      CALENDAR_ID,
      AbortSignal.timeout(ABORT_AFTER_MS),
      () => {
        harness.attempt = { failureCount: 0, nextAttemptAt: null };
        throw failure;
      },
      { onSettledFailure: recordHandled(harness) },
    ).catch((error: unknown) => error);

    expect(outcome).toBe(failure);
    expect(harness.handled).toEqual([]);
  });

  it("does not run when the compare-and-set that arms the backoff loses", async () => {
    const harness = createHarness({
      attempt: { failureCount: 2, nextAttemptAt: null },
      winsCompareAndSet: false,
    });
    const failure = credentialError();

    expect(await runFailing(harness, failure, recordHandled(harness))).toBe(failure);
    expect(harness.handled).toEqual([]);
  });

  it("keeps the ingest failure as the outcome when the handler itself fails", async () => {
    const harness = createHarness({ attempt: { failureCount: 0, nextAttemptAt: null } });
    const failure = credentialError();

    const outcome = await runFailing(harness, failure, () => {
      throw new Error("account update failed");
    });

    expect(outcome).toBe(failure);
  });

  it("never runs when the ingest succeeds", async () => {
    const harness = createHarness({ attempt: { failureCount: 4, nextAttemptAt: null } });

    const result = await runSourceIngest(
      harness.dependencies,
      CALENDAR_ID,
      AbortSignal.timeout(ABORT_AFTER_MS),
      () => Promise.resolve("ingested"),
      { onSettledFailure: recordHandled(harness) },
    );

    expect(result).toBe("ingested");
    expect(harness.handled).toEqual([]);
  });
});
