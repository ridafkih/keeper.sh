import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import type { EventConference } from "../../../core/events/conference";

interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
  backgroundColor?: string;
  foregroundColor?: string;
}

interface GoogleCalendarListResponse {
  kind: "calendar#calendarList";
  items: GoogleCalendarListEntry[];
  nextPageToken?: string;
}

interface GoogleEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleConferenceEntryPoint {
  entryPointType?: string;
  label?: string;
  pin?: string;
  uri?: string;
}

interface GoogleConferenceData {
  conferenceId?: string;
  conferenceSolution?: { key?: { type?: string }; name?: string };
  entryPoints?: GoogleConferenceEntryPoint[];
}

interface GoogleCalendarEvent {
  conferenceData?: GoogleConferenceData;
  hangoutLink?: string;
  id?: string;
  iCalUID?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  created?: string;
  updated?: string;
  eventType?: string;
  transparency?: string;
  workingLocationProperties?: {
    type?: string;
    customLocation?: { label?: string };
    officeLocation?: { label?: string };
  };
}

interface GoogleEventsListResponse {
  kind?: "calendar#events";
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface FetchEventsOptions {
  accessToken: string;
  calendarId: string;
  syncToken?: string;
  timeMin?: Date;
  timeMax?: Date;
  maxResults?: number;
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
}

interface FetchEventsResult {
  events: GoogleCalendarEvent[];
  nextSyncToken?: string;
  fullSyncRequired: boolean;
  isDeltaSync?: boolean;
  changedEventIds?: string[];
  cancelledEventIds?: string[];
}

interface EventTimeSlot {
  uid: string;
  sourceEventId?: string;
  startTime: Date;
  endTime: Date;
  sourceEventType?: "default" | "focusTime" | "outOfOffice" | "workingLocation";
  availability: "busy" | "free" | "oof" | "workingElsewhere";
  isAllDay?: boolean;
  startTimeZone?: string;
  title?: string;
  description?: string;
  location?: string;
  conference?: EventConference;
}

export type {
  GoogleCalendarListEntry,
  GoogleCalendarListResponse,
  GoogleEventDateTime,
  GoogleCalendarEvent,
  GoogleConferenceData,
  GoogleConferenceEntryPoint,
  GoogleEventsListResponse,
  FetchEventsOptions,
  FetchEventsResult,
  EventTimeSlot,
};
