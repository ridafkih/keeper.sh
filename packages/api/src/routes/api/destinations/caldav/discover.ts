import { caldavDiscoverRequestSchema } from "@keeper.sh/data-schemas";
import { withAuth, withTracing } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import { CalDAVConnectionError, discoverCalendars } from "../../../../utils/caldav";

const POST = withTracing(
  withAuth(async ({ request }) => {
    const body = await request.json();

    try {
      const { serverUrl, username, password } = caldavDiscoverRequestSchema.assert(body);

      const calendars = await discoverCalendars(serverUrl, {
        password,
        username,
      });

      return Response.json({ calendars });
    } catch (error) {
      if (error instanceof CalDAVConnectionError) {
        return ErrorResponse.badRequest(error.message).toResponse();
      }

      return ErrorResponse.badRequest("Server URL, username, and password are required").toResponse();
    }
  }),
);

export { POST };
