import { listUserCalendars, CalendarListError } from "@keeper.sh/calendar/outlook";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { widelog } from "@/utils/logging";
import { listOAuthCalendars } from "@/utils/oauth-calendar-listing";
import {
  refreshMicrosoftAccessToken,
  refreshMicrosoftSourceAccessToken,
} from "@/utils/oauth-refresh";

const OUTLOOK_PROVIDER = "outlook";

const GET = withWideEvent(
  withAuth(({ request, userId }) => {
    widelog.set("provider.name", "outlook");
    return listOAuthCalendars(request, userId, {
      isCalendarListError: (error): error is CalendarListError =>
        error instanceof CalendarListError,
      listCalendars: async (accessToken) => {
        const calendars = await listUserCalendars(accessToken);
        return calendars.map(({ id, name, isDefaultCalendar }) => ({
          id,
          primary: Boolean(isDefaultCalendar),
          summary: name,
        }));
      },
      provider: OUTLOOK_PROVIDER,
      refreshDestinationAccessToken: refreshMicrosoftAccessToken,
      refreshSourceAccessToken: refreshMicrosoftSourceAccessToken,
    });
  }),
);

export { GET };
