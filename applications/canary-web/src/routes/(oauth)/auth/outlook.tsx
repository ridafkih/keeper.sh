import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthOAuthPreamble } from "../../../features/auth/components/oauth-preamble";
import { fetchAuthCapabilitiesWithApi } from "../../../lib/auth-capabilities";
import {
  getMcpAuthorizationSearch,
  toStringSearchParams,
} from "../../../lib/mcp-auth-flow";

export const Route = createFileRoute("/(oauth)/auth/outlook")({
  loader: async ({ context }) => {
    const capabilities = await fetchAuthCapabilitiesWithApi(context.fetchApi);
    if (!capabilities.socialProviders.microsoft) {
      throw redirect({ to: "/login" });
    }
    return capabilities;
  },
  component: OutlookAuthPage,
  validateSearch: toStringSearchParams,
});

function OutlookAuthPage() {
  const search = Route.useSearch();

  return (
    <AuthOAuthPreamble
      provider="outlook"
      continuationSearch={getMcpAuthorizationSearch(search) ?? undefined}
    />
  );
}
