import useSWR from "swr";
import type { CalendarAccount } from "@/types/api";

/** UI-only slice of an account that has fallen out of authorization. */
export interface ReauthAccount {
  id: string;
  provider: string;
  accountLabel: string;
}

/** Accounts the sync engine has flagged as needing the user to restore access. */
export function useReauthAccounts(): ReauthAccount[] {
  const { data } = useSWR<CalendarAccount[]>("/api/accounts");

  return (data ?? [])
    .filter((account) => account.needsReauthentication)
    .map((account) => ({
      id: account.id,
      provider: account.provider,
      accountLabel: account.accountLabel,
    }));
}

export function reauthHref(account: ReauthAccount): string {
  return `/dashboard/accounts/${account.id}/reconnect`;
}
