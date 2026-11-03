import useSWR from "swr";
import { authClient } from "@/lib/auth-client";

const fetchLinkedProviderIds = async (): Promise<string[]> => {
  const { data } = await authClient.listAccounts();
  return data?.map((account) => account.providerId) ?? [];
};

export const useLinkedProviderIds = () => useSWR("auth/linked-provider-ids", fetchLinkedProviderIds);
