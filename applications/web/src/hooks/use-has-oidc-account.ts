import useSWR from "swr";
import { authClient } from "@/lib/auth-client";

const fetchHasOidcAccount = async (): Promise<boolean> => {
  const { data } = await authClient.listAccounts();
  return data?.some((account) => account.providerId === "oidc") ?? false;
};

export const useHasOidcAccount = (enabled: boolean) =>
  useSWR(enabled ? "auth/has-oidc-account" : null, fetchHasOidcAccount);
