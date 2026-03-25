import useSWR from "swr";
import { authClient } from "@/lib/auth-client";

const fetchHasPassword = async (): Promise<boolean> => {
  const { data } = await authClient.listAccounts();
  return data?.some((account) => account.providerId === "credential") ?? false;
};

export const useHasPassword = () => useSWR("auth/has-password", fetchHasPassword);
