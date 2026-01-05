import { withAuth, withTracing } from "../../../utils/middleware";
import { ErrorResponse } from "../../../utils/responses";
import { deleteCalendarDestination } from "../../../utils/destinations";

export const DELETE = withTracing(
  withAuth(async ({ params, userId }) => {
    const { id } = params;

    if (!id) {
      return ErrorResponse.badRequest("Destination ID is required").toResponse();
    }

    const deleted = await deleteCalendarDestination(userId, id);

    if (!deleted) {
      return ErrorResponse.notFound().toResponse();
    }

    return Response.json({ success: true });
  }),
);
