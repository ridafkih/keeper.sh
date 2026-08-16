import { handleGetWriteBackDeletionsRoute } from "@/handlers/write-back-deletion-routes";
import { listWriteBackDeletions } from "@/queries/list-write-back-deletions";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";

const GET = withWideEvent(
  withAuth(({ userId }) =>
    handleGetWriteBackDeletionsRoute(
      { userId },
      {
        listWriteBackDeletions: (ownerId, now) => listWriteBackDeletions(database, ownerId, now),
      },
    ),
  ),
);

export { GET };
