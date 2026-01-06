import { caldavDiscoverSourceSchema } from "@keeper.sh/data-schemas";
import { createCalDAVClient } from "@keeper.sh/provider-caldav";
import { withAuth, withWideEvent } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";

const POST = withWideEvent(
  withAuth(async ({ request }) => {
    const body = await request.json();

    try {
      const { serverUrl, username, password } = caldavDiscoverSourceSchema.assert(body);

      const client = createCalDAVClient({
        credentials: {
          password,
          username,
        },
        serverUrl,
      });

      const calendars = await client.discoverCalendars();

      return Response.json({ calendars });
    } catch (error) {
      if (error instanceof Error && error.message.includes("401")) {
        return ErrorResponse.unauthorized("Invalid credentials").toResponse();
      }

      return ErrorResponse.badRequest("Failed to discover calendars").toResponse();
    }
  }),
);

export { POST };
