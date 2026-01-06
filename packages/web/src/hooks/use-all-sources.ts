import useSWR, { type SWRResponse } from "swr";
import type { ProviderId } from "@keeper.sh/provider-registry";

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

const fetchAllSources = async (): Promise<UnifiedSource[]> => {
  const response = await fetch("/api/sources");
  if (!response.ok) {
    return [];
  }
  return response.json();
};

const useAllSources = (): SWRResponse<UnifiedSource[]> =>
  useSWR("all-calendar-sources", fetchAllSources);

export { useAllSources };
export type { UnifiedSource, SourceType };
