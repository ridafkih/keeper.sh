import { createKeeperApi } from "../../../read-models";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { database } from "../../../context";

const keeperApi = createKeeperApi(database);

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const destinations = await keeperApi.getSyncStatuses(userId);
    return Response.json({ destinations });
  }),
);

export { GET };
