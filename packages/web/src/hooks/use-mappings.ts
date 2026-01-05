import useSWR, { type SWRResponse } from "swr";

interface SourceDestinationMapping {
  id: string;
  sourceId: string;
  destinationId: string;
  createdAt: string;
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

const updateSourceDestinations = async (
  sourceId: string,
  destinationIds: string[],
): Promise<void> => {
  const response = await fetch(`/api/ics/${sourceId}/destinations`, {
    body: JSON.stringify({ destinationIds }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error("Failed to update source destinations");
  }
};

export { useMappings, updateSourceDestinations };
export type { SourceDestinationMapping };
