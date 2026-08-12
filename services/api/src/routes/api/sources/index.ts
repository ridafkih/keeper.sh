import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, encryptionKey } from "@/context";
import { createKeeperApi } from "@/read-models";

const keeperApi = createKeeperApi(database, { encryptionKey });

const GET = withWideEvent(
  withAuth(async ({ userId }) =>
    Response.json(await keeperApi.listSources(userId))),
);

export { GET };
