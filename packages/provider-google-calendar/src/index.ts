// Source exports
export { listUserCalendars, CalendarListError } from "./source/utils/list-calendars";
export { fetchCalendarEvents, parseGoogleEvents, EventsFetchError } from "./source/utils/fetch-events";
export {
  createGoogleCalendarSourceProvider,
  GoogleCalendarSourceProvider,
  type CreateGoogleSourceProviderConfig,
  type GoogleSourceAccount,
  type GoogleSourceConfig,
} from "./source/provider";
export type {
  GoogleCalendarListEntry,
  GoogleCalendarListResponse,
  GoogleEventDateTime,
  GoogleCalendarEvent,
  GoogleEventsListResponse,
  FetchEventsOptions,
  FetchEventsResult,
  EventTimeSlot,
} from "./source/types";

export {
  createGoogleCalendarProvider,
  type GoogleCalendarProviderConfig,
} from "./destination/provider";
export { type OAuthTokenProvider } from "@keeper.sh/provider-core";
export {
  getGoogleAccountsByPlan,
  getGoogleAccountsForUser,
  getUserEvents,
  type GoogleAccount,
} from "./destination/sync";

export {
  GOOGLE_CALENDAR_API,
  GOOGLE_CALENDAR_EVENTS_URL,
  GOOGLE_CALENDAR_LIST_URL,
  GOOGLE_CALENDAR_MAX_RESULTS,
  GONE_STATUS,
} from "./shared/api";
export { hasRateLimitMessage, isAuthError, isSimpleAuthError } from "./shared/errors";
export { parseEventDateTime, parseEventTime } from "./shared/date-time";
export type {
  GoogleDateTime,
  PartialGoogleDateTime,
  GoogleApiError,
} from "./types";
