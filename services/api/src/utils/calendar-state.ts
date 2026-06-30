const RECONNECTED_CALENDAR_STATE = {
  disabled: false,
  failureCount: 0,
  lastFailureAt: null,
  nextAttemptAt: null,
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  ingestNextAttemptAt: null,
} as const;

const buildReconnectedCalendarState = (calendarUrl: string) => ({
  calendarUrl,
  ...RECONNECTED_CALENDAR_STATE,
});

export { buildReconnectedCalendarState, RECONNECTED_CALENDAR_STATE };
