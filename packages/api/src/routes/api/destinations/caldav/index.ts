import { caldavConnectRequestSchema } from "@keeper.sh/data-schemas";
import { withAuth, withTracing } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import {
  CalDAVConnectionError,
  DestinationLimitError,
  createCalDAVDestination,
  isValidProvider,
} from "../../../../utils/caldav";

const POST = withTracing(
  withAuth(async ({ request, userId }) => {
    const body = await request.json();

    try {
      const { serverUrl, username, password, calendarUrl, provider } =
        caldavConnectRequestSchema.assert(body);

      const providerName = provider ?? "caldav";
      if (!isValidProvider(providerName)) {
        return ErrorResponse.badRequest("Invalid provider").toResponse();
      }

      await createCalDAVDestination(
        userId,
        providerName,
        serverUrl,
        { password, username },
        calendarUrl,
      );

      return Response.json({ success: true }, { status: 201 });
    } catch (error) {
      if (error instanceof DestinationLimitError) {
        return ErrorResponse.paymentRequired(error.message).toResponse();
      }
      if (error instanceof CalDAVConnectionError) {
        return ErrorResponse.badRequest(error.message).toResponse();
      }

      return ErrorResponse.badRequest("All fields are required").toResponse();
    }
  }),
);

export { POST };
