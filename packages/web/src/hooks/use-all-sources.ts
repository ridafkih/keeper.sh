import useSWR, { type SWRResponse } from "swr";
import { isProviderId, type ProviderId } from "@keeper.sh/provider-registry";

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
  serverUrl: string;
  username: string;
}

const fetchIcsSources = async (): Promise<ICSSource[]> => {
  const response = await fetch("/api/ics");
  if (!response.ok) {
    return [];
  }
  return response.json();
};

const fetchGoogleSources = async (): Promise<OAuthSource[]> => {
  const response = await fetch("/api/sources/google");
  if (!response.ok) {
    return [];
  }
  return response.json();
};

const fetchOutlookSources = async (): Promise<OAuthSource[]> => {
  const response = await fetch("/api/sources/outlook");
  if (!response.ok) {
    return [];
  }
  return response.json();
};

const fetchCalDAVSources = async (): Promise<CalDAVSource[]> => {
  const response = await fetch("/api/sources/caldav");
  if (!response.ok) {
    return [];
  }
  return response.json();
};

const mapProviderToSourceType = (provider: string): SourceType => {
  if (!isProviderId(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return provider;
};

const fetchAllSources = async (): Promise<UnifiedSource[]> => {
  const [icsSources, googleSources, outlookSources, caldavSources] = await Promise.all([
    fetchIcsSources(),
    fetchGoogleSources(),
    fetchOutlookSources(),
    fetchCalDAVSources(),
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

  for (const source of googleSources) {
    unified.push({
      email: source.email ?? undefined,
      id: source.id,
      name: source.name,
      provider: source.provider,
      type: "google",
    });
  }

  for (const source of outlookSources) {
    unified.push({
      email: source.email ?? undefined,
      id: source.id,
      name: source.name,
      provider: source.provider,
      type: "outlook",
    });
  }

  for (const source of caldavSources) {
    unified.push({
      id: source.id,
      name: source.name,
      provider: source.provider,
      type: mapProviderToSourceType(source.provider),
      url: source.calendarUrl,
    });
  }

  return unified;
};

const useAllSources = (): SWRResponse<UnifiedSource[]> =>
  useSWR("all-calendar-sources", fetchAllSources);

export { useAllSources };
export type { UnifiedSource, SourceType };
