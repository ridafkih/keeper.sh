import { createKeeperApi } from "@keeper.sh/keeper-api";
import type { KeeperSource } from "@keeper.sh/keeper-api";
import { withV1Auth, withWideEvent } from "../../../../utils/middleware";
import { database } from "../../../../context";

const keeperApi = createKeeperApi(database);

const toCalendar = (source: KeeperSource) => ({
  id: source.id,
  name: source.name,
  provider: source.providerName,
  account: source.accountLabel,
});

export const GET = withWideEvent(
  withV1Auth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const providerFilter = url.searchParams.get("provider");

    let sources = await keeperApi.listSources(userId);

    if (providerFilter) {
      const providers = providerFilter.split(",").filter(Boolean);
      sources = sources.filter((source) => providers.includes(source.provider));
    }

    return Response.json(sources.map((source) => toCalendar(source)));
  }),
);
