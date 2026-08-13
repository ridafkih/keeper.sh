import { createKeeperApi } from "@/read-models";
import { handleGetEventsInRangeRoute } from "@/handlers/event-routes";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";

const keeperApi = createKeeperApi(database);

export const GET = withWideEvent(
  withAuth(({ request, userId }) => handleGetEventsInRangeRoute(request, userId, keeperApi)),
);
