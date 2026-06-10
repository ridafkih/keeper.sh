export interface CalendarAccount {
  id: string;
  provider: string;
  providerName: string;
  providerIcon: string | null;
  displayName: string | null;
  email: string | null;
  accountLabel: string;
  accountIdentifier: string | null;
  authType: string;
  needsReauthentication: boolean;
  calendarCount: number;
  createdAt: string;
}

export interface CalendarSource {
  id: string;
  name: string;
  calendarType: string;
  capabilities: string[];
  accountId: string;
  provider: string;
  providerName: string;
  providerIcon: string | null;
  displayName: string | null;
  email: string | null;
  accountLabel: string;
  accountIdentifier: string | null;
  needsReauthentication: boolean;
  includeInIcalFeed: boolean;
}

export interface CalendarDetail {
  id: string;
  name: string;
  originalName: string | null;
  calendarType: string;
  capabilities: string[];
  provider: string;
  providerName: string;
  providerIcon: string | null;
  url: string | null;
  calendarUrl: string | null;
  customEventName: string;
  excludeAllDayEvents: boolean;
  excludeEventDescription: boolean;
  excludeEventLocation: boolean;
  excludeEventName: boolean;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  destinationIds: string[];
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiEvent {
  id: string;
  startTime: string;
  endTime: string;
  calendarId: string;
  calendarName: string;
  calendarProvider: string;
  calendarUrl: string;
}

export interface ApiEventSummary {
  id: string;
  startTime: string;
}
