import type { CalendarBackoffState } from "@keeper.sh/calendar";
import {
  isOAuthRefreshInProgressError,
  isOAuthRefreshLockUnavailableError,
} from "@keeper.sh/calendar";
import { widelog } from "@/utils/logging";

const OAUTH_REFRESH_CONTENTION_SKIP_LIMIT = 5;

const oauthRefreshSkipStreakByCalendarId = new Map<string, number>();

const recordOAuthRefreshSkip = (calendarId: string): number => {
  const streak = (oauthRefreshSkipStreakByCalendarId.get(calendarId) ?? 0) + 1;
  oauthRefreshSkipStreakByCalendarId.set(calendarId, streak);
  return streak;
};

const forgetOAuthRefreshSkips = (calendarId: string): void => {
  oauthRefreshSkipStreakByCalendarId.delete(calendarId);
};

const isOAuthRefreshContentionStalled = (calendarId: string): boolean =>
  (oauthRefreshSkipStreakByCalendarId.get(calendarId) ?? 0)
    >= OAUTH_REFRESH_CONTENTION_SKIP_LIMIT;

interface SourceIngestAttempt {
  failureCount: number;
  nextAttemptAt: Date | null;
}

interface SourceIngestLease {
  isCurrent: () => Promise<boolean>;
  release: () => Promise<void>;
}

interface SourceIngestDependencies {
  acquireLease: (calendarId: string, signal: AbortSignal) => Promise<SourceIngestLease | null>;
  applyBackoff: (
    calendarId: string,
    observedAttempt: SourceIngestAttempt,
  ) => Promise<CalendarBackoffState | null>;
  readAttempt: (calendarId: string) => Promise<SourceIngestAttempt | null>;
  recordBackoff: (state: CalendarBackoffState) => void;
  resetBackoff: (calendarId: string, observedAttempt: SourceIngestAttempt) => Promise<void>;
}

interface SourceIngestHandlers {
  onSettledFailure?: (error: unknown) => Promise<void> | void;
  shouldApplyBackoff?: (error: unknown) => boolean;
}

const isAttemptDue = (attempt: SourceIngestAttempt, now: Date): boolean =>
  attempt.nextAttemptAt === null || attempt.nextAttemptAt <= now;

const isSameAttempt = (left: SourceIngestAttempt, right: SourceIngestAttempt): boolean =>
  left.failureCount === right.failureCount
  && (left.nextAttemptAt?.getTime() ?? null) === (right.nextAttemptAt?.getTime() ?? null);

const settleSuccess = async (
  dependencies: SourceIngestDependencies,
  calendarId: string,
  attempt: SourceIngestAttempt,
): Promise<void> => {
  if (attempt.failureCount === 0) {
    return;
  }

  try {
    await dependencies.resetBackoff(calendarId, attempt);
  } catch (error) {
    widelog.error("retry.reset_error", error);
  }
};

const settleFailure = async (
  dependencies: SourceIngestDependencies,
  calendarId: string,
  attempt: SourceIngestAttempt,
): Promise<boolean> => {
  try {
    const current = await dependencies.readAttempt(calendarId);
    if (!current || !isSameAttempt(current, attempt)) {
      widelog.set("retry.backoff_skipped", "attempt-state-changed");
      return false;
    }

    const state = await dependencies.applyBackoff(calendarId, attempt);
    if (!state) {
      widelog.set("retry.backoff_skipped", "attempt-state-changed");
      return false;
    }

    dependencies.recordBackoff(state);
    return true;
  } catch (error) {
    widelog.error("retry.backoff_error", error);
    return true;
  }
};

const runFailureHandler = async (
  handlers: SourceIngestHandlers,
  settled: boolean,
  error: unknown,
): Promise<void> => {
  if (!handlers.onSettledFailure) {
    return;
  }

  if (!settled) {
    widelog.set("failure.handler_skipped", "attempt-state-changed");
    return;
  }

  try {
    await handlers.onSettledFailure(error);
  } catch (handlerError) {
    widelog.error("failure.handler_error", handlerError);
  }
};

const runWork = async <TResult>(
  dependencies: SourceIngestDependencies,
  calendarId: string,
  attempt: SourceIngestAttempt,
  lease: SourceIngestLease,
  work: (isCurrent: () => Promise<boolean>) => Promise<TResult>,
  handlers: SourceIngestHandlers,
): Promise<TResult> => {
  try {
    return await work(lease.isCurrent);
  } catch (error) {
    if (isOAuthRefreshLockUnavailableError(error)) {
      forgetOAuthRefreshSkips(calendarId);
      widelog.set("retry.backoff_skipped", "oauth-refresh-lock-unavailable");
      throw error;
    }

    if (isOAuthRefreshInProgressError(error)) {
      widelog.set("retry.backoff_skipped", "oauth-refresh-in-progress");
      widelog.set("oauth.refresh_skip_streak", recordOAuthRefreshSkip(calendarId));
      throw error;
    }

    forgetOAuthRefreshSkips(calendarId);
    if (handlers.shouldApplyBackoff?.(error) === false) {
      widelog.set("retry.backoff_skipped", "provider-credentials-rejected");
      await runFailureHandler(handlers, true, error);
      throw error;
    }
    const settled = await settleFailure(dependencies, calendarId, attempt);
    await runFailureHandler(handlers, settled, error);
    throw error;
  }
};

const runSourceIngest = async <TResult>(
  dependencies: SourceIngestDependencies,
  calendarId: string,
  signal: AbortSignal,
  work: (isCurrent: () => Promise<boolean>) => Promise<TResult>,
  handlers: SourceIngestHandlers = {},
): Promise<TResult | null> => {
  const lease = await dependencies.acquireLease(calendarId, signal);
  if (!lease) {
    signal.throwIfAborted();
    return null;
  }

  try {
    const attempt = await dependencies.readAttempt(calendarId);
    if (!attempt || !isAttemptDue(attempt, new Date())) {
      return null;
    }

    const result = await runWork(dependencies, calendarId, attempt, lease, work, handlers);
    forgetOAuthRefreshSkips(calendarId);
    await settleSuccess(dependencies, calendarId, attempt);
    return result;
  } finally {
    await lease.release().catch((error: unknown) => {
      widelog.error("lease.release_error", error);
    });
  }
};

export { isAttemptDue, isOAuthRefreshContentionStalled, runSourceIngest };
export type {
  SourceIngestAttempt,
  SourceIngestDependencies,
  SourceIngestHandlers,
  SourceIngestLease,
};
