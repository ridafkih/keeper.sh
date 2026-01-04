import { caldavDiscoverRequestSchema } from "@keeper.sh/data-schemas";
import { withTracing, withAuth } from "../../../../utils/middleware";
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
        return Response.json({ error: error.message }, { status: 400 });
      }

      return Response.json(
        { error: "Server URL, username, and password are required" },
        { status: 400 },
      );
    }
  }),
);
