import {
  listGoogleUserCalendars,
  GoogleCalendarListError,
} from "@keeper.sh/calendar";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { widelog } from "@/utils/logging";
import { listOAuthCalendars } from "@/utils/oauth-calendar-listing";
import {
  refreshGoogleAccessToken,
  refreshGoogleSourceAccessToken,
} from "@/utils/oauth-refresh";

const GOOGLE_PROVIDER = "google";

const GET = withWideEvent(
  withAuth(({ request, userId }) => {
    widelog.set("provider.name", "google");
    return listOAuthCalendars(request, userId, {
      isCalendarListError: (error): error is GoogleCalendarListError =>
        error instanceof GoogleCalendarListError,
      listCalendars: async (accessToken) => {
        const calendars = await listGoogleUserCalendars(accessToken);
        return calendars.map((calendar) => ({
          id: calendar.id,
          primary: calendar.primary,
          summary: calendar.summary,
        }));
      },
      provider: GOOGLE_PROVIDER,
      refreshDestinationAccessToken: refreshGoogleAccessToken,
      refreshSourceAccessToken: refreshGoogleSourceAccessToken,
    });
  }),
);

export { GET };
