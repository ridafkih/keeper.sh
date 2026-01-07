import { getOAuthProviders } from "@keeper.sh/provider-registry";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { getUserSources as getIcsSources } from "../../../utils/sources";
import { getUserOAuthSources } from "../../../utils/oauth-sources";
import { getUserCalDAVSources } from "../../../utils/caldav-sources";

interface UnifiedSource {
  id: string;
  name: string;
  type: "ics" | string;
  email?: string;
  url?: string;
  provider?: string;
}

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const oauthProviders = getOAuthProviders();

    const [icsSources, caldavSources, ...oauthResults] = await Promise.all([
      getIcsSources(userId),
      getUserCalDAVSources(userId),
      ...oauthProviders.map(({ id }) => getUserOAuthSources(userId, id)),
    ]);

    const sources: UnifiedSource[] = [];

    for (const source of icsSources) {
      sources.push({
        id: source.id,
        name: source.name,
        type: "ics",
        ...source.url && { url: source.url },
      });
    }

    for (const source of caldavSources) {
      sources.push({
        id: source.id,
        name: source.name,
        provider: source.provider,
        type: source.provider,
        url: source.calendarUrl,
      });
    }

    for (const [index, provider] of oauthProviders.entries()) {
      const providerSources = oauthResults[index] ?? [];

      for (const source of providerSources) {
        sources.push({
          ...source.email && { email: source.email },
          id: source.id,
          name: source.name,
          provider: source.provider,
          type: provider.id,
        });
      }
    }

    return Response.json(sources);
  }),
);

export { GET };
