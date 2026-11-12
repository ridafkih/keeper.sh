import { withAuth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";
import { deleteSync, findSyncDetail, updateSync } from "@/utils/syncs";
import { handleDeleteSyncRoute, handleGetSyncRoute, handlePatchSyncRoute } from "@/handlers/sync-routes";

const findSync = (userId: string, syncId: string) => findSyncDetail(database, userId, syncId);

const GET = withWideEvent(
  withAuth(({ params, userId }) => handleGetSyncRoute({ params, userId }, { findSync })),
);

const PATCH = withWideEvent(
  withAuth(async ({ params, request, userId }) => {
    const payload = await request.json();
    return handlePatchSyncRoute({ body: payload, params, userId }, { findSync, updateSync });
  }),
);

const DELETE = withWideEvent(
  withAuth(({ params, userId }) => handleDeleteSyncRoute({ params, userId }, { deleteSync })),
);

export { DELETE, GET, PATCH };
