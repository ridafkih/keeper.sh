import { CalDAVAuthenticationError } from "@keeper.sh/calendar/caldav";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import type { CalendarInfo } from "@keeper.sh/calendar/caldav";

interface CalDAVDiscoverCredentials {
  serverUrl: string;
  username: string;
  password: string;
}

interface CalDAVDiscoverResult {
  calendars: CalendarInfo[];
  authMethod: string;
}

interface CalDAVDiscoverRouteContext {
  body: unknown;
}

interface CalDAVDiscoverRouteDependencies {
  parseDiscoverBody: (body: unknown) => CalDAVDiscoverCredentials;
  discoverCalendars: (credentials: CalDAVDiscoverCredentials) => Promise<CalDAVDiscoverResult>;
}

const handleCalDAVDiscoverRoute = async (
  context: CalDAVDiscoverRouteContext,
  dependencies: CalDAVDiscoverRouteDependencies,
): Promise<Response> => {
  try {
    const credentials = dependencies.parseDiscoverBody(context.body);
    const { calendars, authMethod } = await dependencies.discoverCalendars(credentials);

    return Response.json({ calendars, authMethod });
  } catch (error) {
    if (error instanceof CalDAVAuthenticationError) {
      widelog.errorFields(error, { slug: "caldav-auth-failed" });
      return ErrorResponse.unauthorized("Invalid credentials").toResponse();
    }

    widelog.errorFields(error, { slug: "caldav-connection-failed" });
    return ErrorResponse.badRequest("Failed to discover calendars").toResponse();
  }
};

export { handleCalDAVDiscoverRoute };
export type {
  CalDAVDiscoverCredentials,
  CalDAVDiscoverResult,
  CalDAVDiscoverRouteDependencies,
};
