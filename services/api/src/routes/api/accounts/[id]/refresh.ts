import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { idParamSchema } from "@/utils/request-query";
import { refreshAccountCalendars } from "@/utils/refresh-account-calendars";
import { markAccountNeedsReauthentication } from "@/utils/account-calendar-discovery";
import { handleAccountRefreshRoute } from "./refresh-route";

const POST = withWideEvent(
  withAuth(({ params, userId }) => {
    if (!params.id || !idParamSchema.allows(params)) {
      return ErrorResponse.badRequest("Account ID is required").toResponse();
    }

    return handleAccountRefreshRoute({ accountId: params.id, userId }, {
      markNeedsReauthentication: markAccountNeedsReauthentication,
      refreshAccountCalendars,
    });
  }),
);

export { POST };
