import { listUserCalendars, CalendarListError } from "@keeper.sh/providers/outlook";
import { withAuth, withWideEvent } from "../../../../utils/middleware";
import { listOAuthCalendars } from "../../../../utils/oauth-calendar-listing";
import {
  refreshMicrosoftAccessToken,
  refreshMicrosoftSourceAccessToken,
} from "../../../../utils/oauth-refresh";

const OUTLOOK_PROVIDER = "outlook";

interface NormalizedOutlookCalendar {
  id: string;
  summary: string;
  primary: boolean;
}

const GET = withWideEvent(
  withAuth(({ request, userId }) =>
    listOAuthCalendars(request, userId, {
      isCalendarListError: (error): error is CalendarListError =>
        error instanceof CalendarListError,
      listCalendars: listUserCalendars,
      normalizeCalendars: (outlookCalendars): NormalizedOutlookCalendar[] =>
        outlookCalendars.map(({ id, name, isDefaultCalendar }) => ({
          id,
          primary: Boolean(isDefaultCalendar),
          summary: name,
        })),
      provider: OUTLOOK_PROVIDER,
      refreshDestinationAccessToken: refreshMicrosoftAccessToken,
      refreshSourceAccessToken: refreshMicrosoftSourceAccessToken,
    })),
);

export { GET };
