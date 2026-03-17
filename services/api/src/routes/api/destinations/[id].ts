import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { deleteCalendarDestination } from "@/utils/destinations";
import { idParamSchema } from "@/utils/request-query";

export const DELETE = withWideEvent(
  withAuth(async ({ params, userId }) => {
    widelog.set("operation.name", "DELETE /api/destinations/:id");
    if (!params.id || !idParamSchema.allows(params)) {
      return ErrorResponse.badRequest("Destination ID is required").toResponse();
    }
    const { id } = params;

    const deleted = await deleteCalendarDestination(userId, id);

    if (!deleted) {
      return ErrorResponse.notFound().toResponse();
    }

    return Response.json({ success: true });
  }),
);
