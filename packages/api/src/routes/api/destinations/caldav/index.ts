import { caldavConnectRequestSchema } from "@keeper.sh/data-schemas";
import { withTracing, withAuth } from "../../../../utils/middleware";
import {
  createCalDAVDestination,
  isValidProvider,
  DestinationLimitError,
  CalDAVConnectionError,
} from "../../../../utils/caldav";

export const POST = withTracing(
  withAuth(async ({ request, userId }) => {
    const body = await request.json();

    try {
      const { serverUrl, username, password, calendarUrl, provider } =
        caldavConnectRequestSchema.assert(body);

      const providerName = provider ?? "caldav";
      if (!isValidProvider(providerName)) {
        return Response.json({ error: "Invalid provider" }, { status: 400 });
      }

      await createCalDAVDestination(
        userId,
        providerName,
        serverUrl,
        { username, password },
        calendarUrl,
      );

      return Response.json({ success: true }, { status: 201 });
    } catch (error) {
      if (error instanceof DestinationLimitError) {
        return Response.json({ error: error.message }, { status: 402 });
      }
      if (error instanceof CalDAVConnectionError) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      return Response.json(
        { error: "All fields are required" },
        { status: 400 },
      );
    }
  }),
);
