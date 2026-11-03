import { CalDAVAuthenticationError } from "@keeper.sh/calendar/caldav";
import { ErrorResponse } from "@/utils/responses";
import { labelFailure, labelFailureResponse } from "@/utils/error-labelling";
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

const readServerHost = (serverUrl: string): string | null => {
  if (!URL.canParse(serverUrl)) return null;
  return new URL(serverUrl).hostname;
};

const handleCalDAVDiscoverRoute = async (
  context: CalDAVDiscoverRouteContext,
  dependencies: CalDAVDiscoverRouteDependencies,
): Promise<Response> => {
  try {
    const credentials = dependencies.parseDiscoverBody(context.body);
    widelog.set("caldav.server_host", readServerHost(credentials.serverUrl));
    const { calendars, authMethod } = await dependencies.discoverCalendars(credentials);

    return Response.json({ calendars, authMethod });
  } catch (error) {
    if (error instanceof CalDAVAuthenticationError) {
      widelog.set("caldav.failure", "invalid_credentials");
      labelFailure(error, { slug: "caldav-auth-failed" });
      return ErrorResponse.unauthorized("Invalid credentials").toResponse();
    }

    const databaseResponse = labelFailureResponse(error, { slug: "caldav-connection-failed" });
    if (databaseResponse) {
      return databaseResponse;
    }

    return ErrorResponse.badRequest("Failed to discover calendars").toResponse();
  }
};

export { handleCalDAVDiscoverRoute };
export type {
  CalDAVDiscoverCredentials,
  CalDAVDiscoverResult,
  CalDAVDiscoverRouteDependencies,
};
