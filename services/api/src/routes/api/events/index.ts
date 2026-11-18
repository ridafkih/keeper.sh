import { createKeeperApi } from "@/read-models";
import { handleGetEventsInRangeRoute } from "@/handlers/event-routes";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, keyring } from "@/context";

const keeperApi = createKeeperApi(database, { keyring });

export const GET = withWideEvent(
  withAuth(({ request, userId }) => handleGetEventsInRangeRoute(request, userId, keeperApi)),
);
