import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, keyring } from "@/context";
import { createKeeperApi } from "@/read-models";

const keeperApi = createKeeperApi(database, { keyring });

const GET = withWideEvent(
  withAuth(async ({ userId }) =>
    Response.json(await keeperApi.listSources(userId))),
);

export { GET };
