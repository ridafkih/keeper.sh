import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthOAuthPreamble } from "../../../features/auth/components/oauth-preamble";
import { fetchAuthCapabilitiesWithApi } from "../../../lib/auth-capabilities";
import {
  getMcpAuthorizationSearch,
  toStringSearchParams,
} from "../../../lib/mcp-auth-flow";

export const Route = createFileRoute("/(oauth)/auth/google")({
  loader: async ({ context }) => {
    const capabilities = await fetchAuthCapabilitiesWithApi(context.fetchApi);
    if (!capabilities.socialProviders.google) {
      throw redirect({ to: "/login" });
    }
    return capabilities;
  },
  component: GoogleAuthPage,
  validateSearch: toStringSearchParams,
});

function GoogleAuthPage() {
  const search = Route.useSearch();

  return (
    <AuthOAuthPreamble
      provider="google"
      authorizationSearch={getMcpAuthorizationSearch(search) ?? undefined}
    />
  );
}
