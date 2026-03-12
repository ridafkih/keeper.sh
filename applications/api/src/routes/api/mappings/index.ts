import { withAuth, withWideEvent } from "../../../utils/middleware";
import { createKeeperApi } from "@keeper.sh/keeper-api";
import { database } from "../../../context";

const keeperApi = createKeeperApi(database);

export const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const mappings = await keeperApi.listMappings(userId);
    return Response.json(mappings);
  }),
);
