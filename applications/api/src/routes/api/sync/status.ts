import { createKeeperReadModels } from "@keeper.sh/mcp-server";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { database } from "../../../context";

const keeperReadModels = createKeeperReadModels(database);

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const destinations = await keeperReadModels.getSyncStatuses(userId);
    return Response.json({ destinations });
  }),
);

export { GET };
