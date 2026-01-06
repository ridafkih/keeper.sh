import useSWR, { type SWRResponse } from "swr";
import {
  getOAuthProviders,
  isProviderId,
  type ProviderId,
} from "@keeper.sh/provider-registry";

type SourceType = "ics" | ProviderId;

interface UnifiedSource {
  id: string;
  name: string;
  type: SourceType;
  email?: string;
  url?: string;
  provider?: string;
  needsReauthentication?: boolean;
}

interface ICSSource {
  id: string;
  name: string;
  url: string;
}

interface OAuthSource {
  id: string;
  name: string;
  provider: string;
  email: string | null;
}

interface CalDAVSource {
  id: string;
  name: string;
  provider: string;
  calendarUrl: string;
}

const fetchJson = async <T>(url: string): Promise<T[]> => {
  const response = await fetch(url);
  if (!response.ok) {
    return [];
  }
  return response.json();
};

const fetchAllSources = async (): Promise<UnifiedSource[]> => {
  const oauthProviders = getOAuthProviders();

  const [icsSources, caldavSources, ...oauthResults] = await Promise.all([
    fetchJson<ICSSource>("/api/ics"),
    fetchJson<CalDAVSource>("/api/sources/caldav"),
    ...oauthProviders.map(({ id }) => fetchJson<OAuthSource>(`/api/sources/${id}`)),
  ]);

  const unified: UnifiedSource[] = [];

  for (const source of icsSources) {
    unified.push({
      id: source.id,
      name: source.name,
      type: "ics",
      url: source.url,
    });
  }

  for (const source of caldavSources) {
    if (!isProviderId(source.provider)) {
      continue;
    }
    unified.push({
      id: source.id,
      name: source.name,
      provider: source.provider,
      type: source.provider,
      url: source.calendarUrl,
    });
  }

  for (const [index, provider] of oauthProviders.entries()) {
    const sources = oauthResults[index] ?? [];

    for (const source of sources) {
      unified.push({
        email: source.email ?? undefined,
        id: source.id,
        name: source.name,
        provider: source.provider,
        type: provider.id,
      });
    }
  }

  return unified;
};

const useAllSources = (): SWRResponse<UnifiedSource[]> =>
  useSWR("all-calendar-sources", fetchAllSources);

export { useAllSources };
export type { UnifiedSource, SourceType };
