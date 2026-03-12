import { withAuth, withWideEvent } from "../../../utils/middleware";
import { createKeeperReadModels } from "@keeper.sh/mcp-server";
import { database } from "../../../context";

const keeperReadModels = createKeeperReadModels(database);

export const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const mappings = await keeperReadModels.listMappings(userId);
    return Response.json(mappings);
  }),
);
