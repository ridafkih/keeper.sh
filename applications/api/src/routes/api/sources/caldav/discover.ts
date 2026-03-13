import { caldavDiscoverSourceSchema } from "@keeper.sh/data-schemas";
import { createCalDAVClient } from "@keeper.sh/provider-caldav";
import { withAuth, withWideEvent } from "../../../../utils/middleware";
import { respondWithLoggedError, widelog } from "../../../../utils/logging";
import { ErrorResponse } from "../../../../utils/responses";
import { extractServerHost } from "../../../../utils/caldav";

const POST = withWideEvent(
  withAuth(async ({ request }) => {
    const body = await request.json();

    try {
      const { serverUrl, username, password } = caldavDiscoverSourceSchema.assert(body);

      const serverHost = extractServerHost(serverUrl);

      widelog.set("caldav.server_url", serverUrl);
      if (serverHost) {
        widelog.set("caldav.server_host", serverHost);
      }

      const client = createCalDAVClient({
        credentials: {
          password,
          username,
        },
        serverUrl,
      });

      const calendars = await widelog.time.measure(
        "caldav.discover_ms",
        () => client.discoverCalendars(),
      );

      widelog.set("caldav.calendars_found", calendars.length);

      return Response.json({ calendars });
    } catch (error) {
      if (error instanceof Error && error.message.includes("401")) {
        return respondWithLoggedError(
          error,
          ErrorResponse.unauthorized("Invalid credentials").toResponse(),
        );
      }

      return respondWithLoggedError(
        error,
        ErrorResponse.badRequest("Failed to discover calendars").toResponse(),
      );
    }
  }),
);

export { POST };
