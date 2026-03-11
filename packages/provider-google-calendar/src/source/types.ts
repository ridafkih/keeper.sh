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
  availability: "busy" | "free" | "oof" | "workingElsewhere";
  isAllDay?: boolean;
  startTimeZone?: string;
  title?: string;
  description?: string;
  location?: string;
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
