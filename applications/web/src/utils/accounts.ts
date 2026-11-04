const CALENDAR_DISCOVERY_AUTH_TYPES = new Set(["oauth", "caldav"]);

export const canRefreshCalendars = (account: { authType: string }): boolean =>
  CALENDAR_DISCOVERY_AUTH_TYPES.has(account.authType);
