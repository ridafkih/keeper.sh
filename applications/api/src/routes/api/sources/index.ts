import { withAuth, withWideEvent } from "../../../utils/middleware";
import { database } from "../../../context";
import { createKeeperApi } from "@keeper.sh/keeper-api";

const keeperApi = createKeeperApi(database);

const GET = withWideEvent(
  withAuth(async ({ userId }) =>
    Response.json(await keeperApi.listSources(userId))),
);

export { GET };
