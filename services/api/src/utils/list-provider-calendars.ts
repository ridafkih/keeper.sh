import { resolveGoogleCalendarColor, resolveOutlookCalendarColor } from "@keeper.sh/calendar";
import { listUserCalendars as listGoogleCalendars } from "@keeper.sh/calendar/google";
import { listUserCalendars as listOutlookCalendars } from "@keeper.sh/calendar/outlook";

interface ExternalCalendar {
  externalId: string;
  name: string;
  color: string | null;
}

const listProviderCalendars = async (
  provider: string,
  accessToken: string,
  ownerEmail: string | null = null,
): Promise<ExternalCalendar[]> => {
  if (provider === "google") {
    const calendars = await listGoogleCalendars(accessToken);
    return calendars.map((calendar) => ({
      color: resolveGoogleCalendarColor(calendar.backgroundColor),
      externalId: calendar.id,
      name: calendar.summary,
    }));
  }

  if (provider === "outlook") {
    const calendars = await listOutlookCalendars(accessToken, { ownerEmail });
    return calendars.map((calendar) => ({
      color: resolveOutlookCalendarColor(calendar.hexColor, calendar.color),
      externalId: calendar.id,
      name: calendar.name,
    }));
  }

  throw new Error(`No calendar listing support for provider: ${provider}`);
};

export { listProviderCalendars };
export type { ExternalCalendar };
