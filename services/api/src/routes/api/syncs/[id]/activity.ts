import { withAuth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";
import { findSyncForUser, listSyncActivity } from "@/utils/syncs";
import { handleSyncActivityRoute } from "@/handlers/sync-routes";

const GET = withWideEvent(
  withAuth(({ params, request, userId }) => handleSyncActivityRoute(
    { params, searchParams: new URL(request.url).searchParams, userId },
    {
      listActivity: (syncId, options) => listSyncActivity(database, syncId, options),
      syncExists: async (resolvedUserId, syncId) => Boolean(await findSyncForUser(database, resolvedUserId, syncId)),
    },
  )),
);

export { GET };
