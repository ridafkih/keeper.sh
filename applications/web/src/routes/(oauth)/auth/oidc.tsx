import { useEffect } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchAuthCapabilitiesWithApi } from "@/lib/auth-capabilities";
import { authClient } from "@/lib/auth-client";
import { withSignupMarker } from "@/lib/signup-marker";
import {
  getMcpAuthorizationSearch,
  resolveClientPostAuthRedirect,
  toStringSearchParams,
} from "@/lib/mcp-auth-flow";

export const Route = createFileRoute("/(oauth)/auth/oidc")({
  loader: async ({ context }) => {
    const capabilities = await fetchAuthCapabilitiesWithApi(context.fetchApi);
    if (!capabilities.socialProviders.oidc) {
      throw redirect({ to: "/login" });
    }
    return capabilities;
  },
  component: OidcAuthPage,
  validateSearch: toStringSearchParams,
});

function OidcAuthPage() {
  const search = Route.useSearch();

  useEffect(() => {
    const authorizationSearch = getMcpAuthorizationSearch(search) ?? undefined;
    const callbackURL = resolveClientPostAuthRedirect(authorizationSearch);

    void authClient.signIn.oauth2({
      providerId: "oidc",
      callbackURL,
      newUserCallbackURL: withSignupMarker(callbackURL, globalThis.location.origin),
    });
  }, [search]);

  return null;
}
