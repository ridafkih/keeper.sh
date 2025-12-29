import useSWR from "swr";

interface IcalTokenResponse {
  token: string;
  icalUrl: string | null;
}

const fetcher = async (url: string): Promise<IcalTokenResponse> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch");
  return response.json();
};

export const useIcalToken = () => {
  const { data, error, isLoading } = useSWR<IcalTokenResponse>(
    "/api/ical/token",
    fetcher,
  );

  return {
    token: data?.token,
    icalUrl: data?.icalUrl ?? null,
    error,
    isLoading,
  };
};
