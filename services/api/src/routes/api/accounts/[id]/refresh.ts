import { withAuth, withWideEvent } from "@/utils/middleware";
import type { AuthenticatedRouteCallback } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { idParamSchema } from "@/utils/request-query";
import {
  acquireAccountRefreshLock,
  refreshAccountCalendars,
} from "@/utils/account-calendar-refresh";
import { handleAccountRefreshRoute } from "./refresh-route";

const refreshAccount: AuthenticatedRouteCallback = ({ params, userId }) => {
  if (!params.id || !idParamSchema.allows(params)) {
    return ErrorResponse.badRequest("Account ID is required").toResponse();
  }

  return handleAccountRefreshRoute({ accountId: params.id, userId }, {
    acquireRefreshLock: acquireAccountRefreshLock,
    refreshCalendars: refreshAccountCalendars,
  });
};

const POST = withWideEvent(withAuth(refreshAccount));

export { POST, refreshAccount };
