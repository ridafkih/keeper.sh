import { createKeeperApi } from "@keeper.sh/keeper-api";
import { withV1Auth, withWideEvent } from "../../../utils/middleware";
import { database } from "../../../context";

const keeperApi = createKeeperApi(database);

export const GET = withWideEvent(
  withV1Auth(async ({ userId }) => {
    const count = await keeperApi.getEventCount(userId);
    return Response.json({ count });
  }),
);
