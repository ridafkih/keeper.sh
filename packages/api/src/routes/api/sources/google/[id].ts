import { withAuth, withWideEvent } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import { deleteOAuthSource } from "../../../../utils/oauth-sources";

export const DELETE = withWideEvent(
  withAuth(async ({ params, userId }) => {
    const { id } = params;

    if (!id) {
      return ErrorResponse.badRequest("ID is required").toResponse();
    }

    const deleted = await deleteOAuthSource(userId, id);

    if (!deleted) {
      return ErrorResponse.notFound().toResponse();
    }

    return Response.json({ success: true });
  }),
);
