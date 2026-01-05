import { withAuth, withTracing } from "../../../utils/middleware";
import { ErrorResponse } from "../../../utils/responses";
import { deleteSource } from "../../../utils/sources";

export const DELETE = withTracing(
  withAuth(async ({ params, userId }) => {
    const { id } = params;

    if (!id) {
      return ErrorResponse.badRequest("ID is required").toResponse();
    }

    const deleted = await deleteSource(userId, id);

    if (!deleted) {
      return ErrorResponse.notFound().toResponse();
    }

    return Response.json({ success: true });
  }),
);
