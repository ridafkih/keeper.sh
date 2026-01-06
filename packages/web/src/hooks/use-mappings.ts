import useSWR, { type SWRResponse } from "swr";

type SourceType = "ics" | "oauth" | "caldav";

interface SourceDestinationMapping {
  id: string;
  sourceId: string;
  destinationId: string;
  createdAt: string;
  sourceType: SourceType;
}

const fetchMappings = async (): Promise<SourceDestinationMapping[]> => {
  const response = await fetch("/api/mappings");
  if (!response.ok) {
    throw new Error("Failed to fetch mappings");
  }
  return response.json();
};

const useMappings = (): SWRResponse<SourceDestinationMapping[]> =>
  useSWR("source-destination-mappings", fetchMappings);

const getUpdateEndpoint = (sourceId: string, sourceType: SourceType): string => {
  switch (sourceType) {
    case "oauth": {
      return `/api/sources/oauth/${sourceId}/destinations`;
    }
    case "caldav": {
      return `/api/sources/caldav/${sourceId}/destinations`;
    }
    default: {
      return `/api/ics/${sourceId}/destinations`;
    }
  }
};

const updateSourceDestinations = async (
  sourceId: string,
  destinationIds: string[],
  sourceType: SourceType = "ics",
): Promise<void> => {
  const endpoint = getUpdateEndpoint(sourceId, sourceType);
  const response = await fetch(endpoint, {
    body: JSON.stringify({ destinationIds }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error("Failed to update source destinations");
  }
};

export { useMappings, updateSourceDestinations };
export type { SourceDestinationMapping, SourceType };
