import { withAuth, withWideEvent } from "../../../utils/middleware";
import { createKeeperApi } from "@keeper.sh/keeper-api";
import { database } from "../../../context";

const keeperApi = createKeeperApi(database);

export const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const destinations = await keeperApi.listDestinations(userId);
    return Response.json(destinations);
  }),
);
