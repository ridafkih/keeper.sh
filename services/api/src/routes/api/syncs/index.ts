import { withAuth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";
import { createSync, findSyncDetail, listSyncs } from "@/utils/syncs";
import { handleCreateSyncRoute, handleListSyncsRoute } from "@/handlers/sync-routes";

const GET = withWideEvent(
  withAuth(({ userId }) => handleListSyncsRoute(
    { userId },
    { listSyncs: (resolvedUserId) => listSyncs(database, resolvedUserId) },
  )),
);

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const payload = await request.json();
    return handleCreateSyncRoute({ body: payload, userId }, {
      createSync,
      findSync: (resolvedUserId, syncId) => findSyncDetail(database, resolvedUserId, syncId),
    });
  }),
);

export { GET, POST };
