import { caldavDiscoverRequestSchema } from "@keeper.sh/data-schemas";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { widelog } from "@/utils/logging";
import { ErrorResponse } from "@/utils/responses";
import { CalDAVConnectionError, discoverCalendars } from "@/utils/caldav";

const POST = withWideEvent(
  withAuth(async ({ request }) => {
    widelog.set("provider.name", "caldav");
    const body = await request.json();

    try {
      const { serverUrl, username, password } = caldavDiscoverRequestSchema.assert(body);

      const result = await discoverCalendars(serverUrl, {
        password,
        username,
      });

      return Response.json({ calendars: result.calendars, authMethod: result.authMethod });
    } catch (error) {
      if (error instanceof CalDAVConnectionError) {
        return ErrorResponse.badRequest(error.message).toResponse();
      }

      return ErrorResponse.badRequest(
        "Server URL, username, and password are required",
      ).toResponse();
    }
  }),
);

export { POST };
