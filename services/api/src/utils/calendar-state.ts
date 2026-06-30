const buildReconnectedCalendarState = (calendarUrl: string) => ({
  calendarUrl,
  disabled: false,
  failureCount: 0,
  lastFailureAt: null,
  nextAttemptAt: null,
});

export { buildReconnectedCalendarState };
