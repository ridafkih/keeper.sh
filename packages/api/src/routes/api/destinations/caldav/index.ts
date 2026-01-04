import { caldavConnectRequestSchema } from "@keeper.sh/data-schemas";
import { withTracing, withAuth } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
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
        return ErrorResponse.badRequest("Invalid provider");
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
        return ErrorResponse.paymentRequired(error.message);
      }
      if (error instanceof CalDAVConnectionError) {
        return ErrorResponse.badRequest(error.message);
      }

      return ErrorResponse.badRequest("All fields are required");
    }
  }),
);
