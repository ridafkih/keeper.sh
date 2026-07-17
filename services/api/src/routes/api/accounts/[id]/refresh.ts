import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { idParamSchema } from "@/utils/request-query";
import { AccountNotFoundError, refreshAccountCalendars } from "@/utils/refresh-account-calendars";

const POST = withWideEvent(
  withAuth(async ({ params, userId }) => {
    if (!params.id || !idParamSchema.allows(params)) {
      return ErrorResponse.badRequest("Account ID is required").toResponse();
    }
    const { id } = params;

    try {
      const result = await refreshAccountCalendars(userId, id);
      return Response.json(result);
    } catch (error) {
      if (error instanceof AccountNotFoundError) {
        return ErrorResponse.notFound(error.message).toResponse();
      }
      throw error;
    }
  }),
);

export { POST };
