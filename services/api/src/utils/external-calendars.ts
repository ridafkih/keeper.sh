import {
  isGoogleAccessRoleWritable,
  isOutlookCalendarWritable,
  resolveCalendarCapabilities,
  resolveGoogleCalendarColor,
  resolveOutlookCalendarColor,
} from "@keeper.sh/calendar";

const OAUTH_CALENDAR_TYPE = "oauth";

interface ExternalCalendar {
  color: string | null;
  externalId: string;
  name: string;
  writable: boolean;
}

interface GoogleCalendarListing {
  accessRole: string;
  backgroundColor?: string;
  id: string;
  summary: string;
}

interface OutlookCalendarListing {
  canEdit?: boolean;
  color?: string;
  hexColor?: string;
  id: string;
  name: string;
}

const fromGoogleCalendarListEntries = (entries: GoogleCalendarListing[]): ExternalCalendar[] =>
  entries.map((entry) => ({
    color: resolveGoogleCalendarColor(entry.backgroundColor),
    externalId: entry.id,
    name: entry.summary,
    writable: isGoogleAccessRoleWritable(entry.accessRole),
  }));

const fromOutlookCalendarListEntries = (entries: OutlookCalendarListing[]): ExternalCalendar[] =>
  entries.map((entry) => ({
    color: resolveOutlookCalendarColor(entry.hexColor, entry.color),
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
  color: calendar.color,
  externalCalendarId: calendar.externalId,
  name: calendar.name,
  originalName: calendar.name,
  userId,
});

export { fromGoogleCalendarListEntries, fromOutlookCalendarListEntries, toOAuthCalendarInsert };
export type { ExternalCalendar };
