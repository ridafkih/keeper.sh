import useSWR from "swr";

export interface SourceDestinationMapping {
  id: string;
  sourceId: string;
  destinationId: string;
  createdAt: string;
}

async function fetchMappings(): Promise<SourceDestinationMapping[]> {
  const response = await fetch("/api/mappings");
  if (!response.ok) {
    throw new Error("Failed to fetch mappings");
  }
  return response.json();
}

export function useMappings() {
  return useSWR("source-destination-mappings", fetchMappings);
}

export async function updateSourceDestinations(
  sourceId: string,
  destinationIds: string[],
): Promise<void> {
  const response = await fetch(`/api/ics/${sourceId}/destinations`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destinationIds }),
  });

  if (!response.ok) {
    throw new Error("Failed to update source destinations");
  }
}
