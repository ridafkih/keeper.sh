import { createKeeperApi } from "@keeper.sh/keeper-api";
import { withV1Auth, withWideEvent } from "../../../utils/middleware";
import { database } from "../../../context";
import type { KeeperSource } from "@keeper.sh/keeper-api";

const keeperApi = createKeeperApi(database);

const toCalendar = (source: KeeperSource) => ({
  id: source.id,
  name: source.name,
  provider: source.providerName,
  account: source.accountLabel,
});

export const GET = withWideEvent(
  withV1Auth(async ({ userId }) => {
    const sources = await keeperApi.listSources(userId);
    return Response.json(sources.map((source) => toCalendar(source)));
  }),
);
