import { useNavigate, useSearch } from "@tanstack/react-router";

export type ConnectReturnTo = "onboarding";

export interface ConnectSearch {
  returnTo?: ConnectReturnTo;
}

export const readConnectSearch = (search: Record<string, unknown>): ConnectSearch => ({
  returnTo: search.returnTo === "onboarding" ? "onboarding" : undefined,
});

export function useConnectReturnTo(): ConnectReturnTo | undefined {
  const search: ConnectSearch = useSearch({ strict: false });
  return search.returnTo;
}

// A calendar connected during onboarding goes back to the wizard; anywhere else it opens the setup sentence.
export function useNavigateAfterConnect(): (accountId?: string) => Promise<void> {
  const navigate = useNavigate();
  const returnTo = useConnectReturnTo();

  return async (accountId) => {
    const search = accountId ? { accountId } : {};
    if (returnTo === "onboarding") {
      await navigate({ search: { ...search, step: "connect" }, to: "/onboarding" });
      return;
    }
    await navigate({ search, to: "/dashboard/setup" });
  };
}
