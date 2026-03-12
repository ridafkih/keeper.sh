import { withAuth, withWideEvent } from "../../../utils/middleware";
import { createKeeperReadModels } from "@keeper.sh/mcp-server";
import { database } from "../../../context";

const keeperReadModels = createKeeperReadModels(database);

export const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const destinations = await keeperReadModels.listDestinations(userId);
    return Response.json(destinations);
  }),
);
