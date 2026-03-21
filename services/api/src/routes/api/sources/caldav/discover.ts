import { caldavDiscoverSourceSchema } from "@keeper.sh/data-schemas";
import { createCalDAVClient } from "@keeper.sh/calendar";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import { widelog } from "@/utils/logging";
import { mapCalDAVDiscoverError } from "./discover-error-mapping";

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
      const mapped = mapCalDAVDiscoverError(error);
      widelog.errorFields(error, { slug: mapped.slug });
      return mapped.response;
    }
  }),
);

export { POST };
