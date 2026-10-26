const INITIAL_CALENDAR_BACKOFF_MS = 5 * 60 * 1000;
const MAX_CALENDAR_BACKOFF_MS = 6 * 60 * 60 * 1000;

interface CalendarBackoffState {
  failureCount: number;
  lastFailureAt: Date | null;
  nextAttemptAt: Date | null;
}

const RESET_CALENDAR_BACKOFF_STATE: CalendarBackoffState = {
  failureCount: 0,
  lastFailureAt: null,
  nextAttemptAt: null,
};

const resolveCalendarBackoffDelayMs = (currentFailureCount: number): number =>
  Math.min(
    INITIAL_CALENDAR_BACKOFF_MS * 2 ** Math.max(0, currentFailureCount),
    MAX_CALENDAR_BACKOFF_MS,
  );

const buildCalendarBackoffState = (
  currentFailureCount: number,
  now = new Date(),
): CalendarBackoffState => {
  const delayMs = resolveCalendarBackoffDelayMs(currentFailureCount);

  return {
    failureCount: currentFailureCount + 1,
    lastFailureAt: now,
    nextAttemptAt: new Date(now.getTime() + delayMs),
  };
};

export { buildCalendarBackoffState, RESET_CALENDAR_BACKOFF_STATE, resolveCalendarBackoffDelayMs };
export type { CalendarBackoffState };
