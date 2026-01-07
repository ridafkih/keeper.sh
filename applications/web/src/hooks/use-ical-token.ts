import useSWR from "swr";

interface IcalTokenResponse {
  token: string;
  icalUrl: string | null;
}

const fetcher = async (url: string): Promise<IcalTokenResponse> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch");
  }
  return response.json();
};

interface IcalTokenResult {
  error: Error | undefined;
  icalUrl: string | null;
  isLoading: boolean;
  token: string | undefined;
}

export const useIcalToken = (): IcalTokenResult => {
  const { data, error, isLoading } = useSWR<IcalTokenResponse>("/api/ical/token", fetcher);

  return {
    error,
    icalUrl: data?.icalUrl ?? null,
    isLoading,
    token: data?.token,
  };
};
