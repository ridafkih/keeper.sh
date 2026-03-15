import { withAuth, withWideEvent } from "../../../utils/middleware";
import { database } from "../../../context";
import { createKeeperApi } from "../../../read-models";

const keeperApi = createKeeperApi(database);

const GET = withWideEvent(
  withAuth(async ({ userId }) =>
    Response.json(await keeperApi.listSources(userId))),
);

export { GET };
