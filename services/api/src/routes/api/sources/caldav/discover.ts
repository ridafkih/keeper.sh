import { caldavDiscoverSourceSchema } from "@keeper.sh/data-schemas";
import { createCalDAVClient } from "@keeper.sh/calendar/caldav";
import { handleCalDAVDiscoverRoute } from "./discover-route";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import type { CalDAVDiscoverCredentials, CalDAVDiscoverResult } from "./discover-route";

const discoverCalendars = async (
  credentials: CalDAVDiscoverCredentials,
): Promise<CalDAVDiscoverResult> => {
  const client = createCalDAVClient({
    credentials: {
      password: credentials.password,
      username: credentials.username,
    },
    serverUrl: credentials.serverUrl,
  }, safeFetchOptions);

  const calendars = await client.discoverCalendars();

  return { authMethod: client.getResolvedAuthMethod() ?? "basic", calendars };
};

const POST = withWideEvent(
  withAuth(async ({ request }) => {
    const body = await request.json();

    return handleCalDAVDiscoverRoute({ body }, {
      discoverCalendars,
      parseDiscoverBody: (value) => caldavDiscoverSourceSchema.assert(value),
    });
  }),
);

export { POST };
