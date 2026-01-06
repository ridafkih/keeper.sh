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

interface GoogleCalendarEvent {
  id: string;
  iCalUID?: string;
  status: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  created?: string;
  updated?: string;
}

interface GoogleEventsListResponse {
  kind: "calendar#events";
  items: GoogleCalendarEvent[];
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
}

interface FetchEventsResult {
  events: GoogleCalendarEvent[];
  nextSyncToken?: string;
  fullSyncRequired: boolean;
  isDeltaSync?: boolean;
  cancelledEventUids?: string[];
}

interface EventTimeSlot {
  uid: string;
  startTime: Date;
  endTime: Date;
}

export type {
  GoogleCalendarListEntry,
  GoogleCalendarListResponse,
  GoogleEventDateTime,
  GoogleCalendarEvent,
  GoogleEventsListResponse,
  FetchEventsOptions,
  FetchEventsResult,
  EventTimeSlot,
};
