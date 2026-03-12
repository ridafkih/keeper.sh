import { createKeeperReadModels } from "@keeper.sh/mcp-server";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { database } from "../../../context";

const keeperReadModels = createKeeperReadModels(database);

export const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const count = await keeperReadModels.getEventCount(userId);
    return Response.json({ count });
  }),
);
