import { caldavDiscoverRequestSchema } from "@keeper.sh/data-schemas";
import { withTracing, withAuth } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import {
  discoverCalendars,
  CalDAVConnectionError,
} from "../../../../utils/caldav";

export const POST = withTracing(
  withAuth(async ({ request }) => {
    const body = await request.json();

    try {
      const { serverUrl, username, password } =
        caldavDiscoverRequestSchema.assert(body);

      const calendars = await discoverCalendars(serverUrl, {
        username,
        password,
      });

      return Response.json({ calendars });
    } catch (error) {
      if (error instanceof CalDAVConnectionError) {
        return ErrorResponse.badRequest(error.message);
      }

      return ErrorResponse.badRequest("Server URL, username, and password are required");
    }
  }),
);
