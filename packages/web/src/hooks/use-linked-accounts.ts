import useSWR from "swr";

interface LinkedAccount {
  id: string;
  providerId: string;
  email: string | null;
}

interface DestinationResponse {
  id: string;
  provider: string;
  email: string | null;
}

const fetchLinkedAccounts = async (): Promise<LinkedAccount[]> => {
  const response = await fetch("/api/destinations");
  if (!response.ok) throw new Error("Failed to fetch linked accounts");
  const data: DestinationResponse[] = await response.json();
  return data.map((destination) => ({
    id: destination.id,
    providerId: destination.provider,
    email: destination.email,
  }));
};

export const useLinkedAccounts = () => {
  return useSWR("linked-accounts", fetchLinkedAccounts);
};
