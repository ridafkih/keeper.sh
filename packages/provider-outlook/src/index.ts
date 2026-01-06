export { listUserCalendars, CalendarListError } from "./source/utils/list-calendars";
export { fetchCalendarEvents, parseOutlookEvents, EventsFetchError } from "./source/utils/fetch-events";
export {
  createOutlookSourceProvider,
  OutlookSourceProvider,
  type CreateOutlookSourceProviderConfig,
  type OutlookSourceAccount,
  type OutlookSourceConfig,
} from "./source/provider";
export type {
  OutlookCalendarListEntry,
  OutlookCalendarListResponse,
  OutlookEventDateTime,
  OutlookCalendarEvent,
  OutlookEventsListResponse,
  FetchEventsOptions,
  FetchEventsResult,
  EventTimeSlot,
} from "./source/types";

export {
  createOutlookCalendarProvider,
  type OutlookCalendarProviderConfig,
} from "./destination/provider";
export { type OAuthTokenProvider } from "@keeper.sh/provider-core";
export {
  getOutlookAccountsByPlan,
  getOutlookAccountsForUser,
  getUserEvents,
  type OutlookAccount,
} from "./destination/sync";

export { MICROSOFT_GRAPH_API, OUTLOOK_PAGE_SIZE, GONE_STATUS } from "./shared/api";
export { hasRateLimitMessage, isAuthError, isSimpleAuthError } from "./shared/errors";
export { parseEventDateTime, parseEventTime } from "./shared/date-time";
export type {
  OutlookDateTime,
  PartialOutlookDateTime,
  MicrosoftApiError,
} from "./types";
