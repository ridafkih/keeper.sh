interface OutlookCalendarListEntry {
  id: string;
  name: string;
  color?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
  owner?: {
    name?: string;
    address?: string;
  };
}

interface OutlookCalendarListResponse {
  value: OutlookCalendarListEntry[];
  "@odata.nextLink"?: string;
}

interface OutlookEventDateTime {
  dateTime: string;
  timeZone: string;
}

interface OutlookRemovedInfo {
  reason: "deleted" | "changed";
}

interface OutlookCalendarEvent {
  id: string;
  iCalUId?: string;
  subject?: string;
  start: OutlookEventDateTime;
  end: OutlookEventDateTime;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  "@removed"?: OutlookRemovedInfo;
}

interface OutlookEventsListResponse {
  value: OutlookCalendarEvent[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

interface FetchEventsOptions {
  accessToken: string;
  calendarId: string;
  deltaLink?: string;
  timeMin?: Date;
  timeMax?: Date;
}

interface FetchEventsResult {
  events: OutlookCalendarEvent[];
  nextDeltaLink?: string;
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
  OutlookCalendarListEntry,
  OutlookCalendarListResponse,
  OutlookEventDateTime,
  OutlookCalendarEvent,
  OutlookEventsListResponse,
  FetchEventsOptions,
  FetchEventsResult,
  EventTimeSlot,
};
