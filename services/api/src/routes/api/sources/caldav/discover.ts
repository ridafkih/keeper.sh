import { caldavDiscoverSourceSchema } from "@keeper.sh/data-schemas";
import { createCalDAVClient } from "@keeper.sh/calendar/caldav";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import { widelog } from "@/utils/logging";

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
      }, safeFetchOptions);

      const calendars = await client.discoverCalendars();

      return Response.json({ calendars });
    } catch (error) {
      if (error instanceof Error && error.message.includes("401")) {
        widelog.errorFields(error, { slug: "caldav-auth-failed" });
        return ErrorResponse.unauthorized("Invalid credentials").toResponse();
      }

      widelog.errorFields(error, { slug: "caldav-connection-failed" });
      return ErrorResponse.badRequest("Failed to discover calendars").toResponse();
    }
  }),
);

export { POST };
