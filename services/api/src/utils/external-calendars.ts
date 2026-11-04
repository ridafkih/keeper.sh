import {
  isGoogleAccessRoleWritable,
  isOutlookCalendarWritable,
  resolveCalendarCapabilities,
} from "@keeper.sh/calendar";

const OAUTH_CALENDAR_TYPE = "oauth";

interface ExternalCalendar {
  externalId: string;
  name: string;
  writable: boolean;
}

interface GoogleCalendarListing {
  accessRole: string;
  id: string;
  summary: string;
}

interface OutlookCalendarListing {
  canEdit?: boolean;
  id: string;
  name: string;
}

const fromGoogleCalendarListEntries = (entries: GoogleCalendarListing[]): ExternalCalendar[] =>
  entries.map((entry) => ({
    externalId: entry.id,
    name: entry.summary,
    writable: isGoogleAccessRoleWritable(entry.accessRole),
  }));

const fromOutlookCalendarListEntries = (entries: OutlookCalendarListing[]): ExternalCalendar[] =>
  entries.map((entry) => ({
    externalId: entry.id,
    name: entry.name,
    writable: isOutlookCalendarWritable(entry.canEdit),
  }));

const toOAuthCalendarInsert = (
  userId: string,
  accountId: string,
  calendar: ExternalCalendar,
) => ({
  accountId,
  calendarType: OAUTH_CALENDAR_TYPE,
  capabilities: resolveCalendarCapabilities(calendar.writable),
  externalCalendarId: calendar.externalId,
  name: calendar.name,
  originalName: calendar.name,
  userId,
});

export { fromGoogleCalendarListEntries, fromOutlookCalendarListEntries, toOAuthCalendarInsert };
export type { ExternalCalendar };
