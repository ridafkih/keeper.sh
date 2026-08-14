const RECONNECTED_BACKOFF_STATE = {
  failureCount: 0,
  lastFailureAt: null,
  nextAttemptAt: null,
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  ingestNextAttemptAt: null,
} as const;

const RECONNECTED_CALENDAR_STATE = {
  disabled: false,
  ...RECONNECTED_BACKOFF_STATE,
} as const;

const buildReconnectedCalDAVState = (calendarUrl: string) => ({
  calendarUrl,
  ...RECONNECTED_BACKOFF_STATE,
});

export {
  buildReconnectedCalDAVState,
  RECONNECTED_BACKOFF_STATE,
  RECONNECTED_CALENDAR_STATE,
};
