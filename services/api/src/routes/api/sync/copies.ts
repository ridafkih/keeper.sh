import { withAuth, withWideEvent } from "@/utils/middleware";
import { widelog } from "@/utils/logging";
import { database } from "@/context";
import { getCopiedEvents } from "@/queries/get-copied-events";
import type { CopiedEvents } from "@/queries/get-copied-events";

const UPCOMING_COPIES_LIMIT = 4;

interface CopiesRouteDependencies {
  getCopiedEvents: (userId: string, limit: number) => Promise<CopiedEvents>;
}

const handleCopiesRoute = async (
  { userId }: { userId: string },
  dependencies: CopiesRouteDependencies,
): Promise<Response> => {
  const copies = await dependencies.getCopiedEvents(userId, UPCOMING_COPIES_LIMIT);
  widelog.set("sync.events_copied", copies.count);
  return Response.json(copies);
};

const GET = withWideEvent(
  withAuth(({ userId }) => handleCopiesRoute({ userId }, {
    getCopiedEvents: (resolvedUserId, limit) => getCopiedEvents(database, resolvedUserId, limit),
  })),
);

export { GET, handleCopiesRoute };
