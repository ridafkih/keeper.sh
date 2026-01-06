import { withAuth, withWideEvent } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import { CalDAVSourceNotFoundError, deleteCalDAVSource } from "../../../../utils/caldav-sources";

const DELETE = withWideEvent(
  withAuth(async ({ params, userId }) => {
    const { id: sourceId } = params;

    if (!sourceId) {
      return ErrorResponse.badRequest("Source ID is required").toResponse();
    }

    try {
      await deleteCalDAVSource(userId, sourceId);
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof CalDAVSourceNotFoundError) {
        return ErrorResponse.notFound(error.message).toResponse();
      }

      throw error;
    }
  }),
);

export { DELETE };
