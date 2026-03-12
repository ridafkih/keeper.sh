import { withAuth, withWideEvent } from "../../../utils/middleware";
import { database } from "../../../context";
import { createKeeperReadModels } from "@keeper.sh/mcp-server";

const keeperReadModels = createKeeperReadModels(database);

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    return Response.json(await keeperReadModels.listSources(userId));
  }),
);

export { GET };
