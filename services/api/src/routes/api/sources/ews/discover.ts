import { EwsClient, EwsError } from "@keeper.sh/calendar/ews";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { resolveEwsRequest } from "@/utils/ews-oauth-session";

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    try {
      const { config, runtime } = await resolveEwsRequest(
        userId,
        await request.json(),
      );
      const calendars = await new EwsClient(
        config,
        runtime,
      ).discoverCalendars();
      return Response.json({ calendars });
    } catch (error) {
      if (error instanceof EwsError) {
        return ErrorResponse.badRequest(
          `EWS discovery failed: ${error.code}`,
        ).toResponse();
      }
      return ErrorResponse.badRequest(
        "Check the EWS endpoint and authentication settings",
      ).toResponse();
    }
  }),
);
export { POST };
