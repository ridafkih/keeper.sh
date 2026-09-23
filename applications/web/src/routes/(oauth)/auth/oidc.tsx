import { useState, type SubmitEvent } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ExternalTextLink } from "@/components/ui/primitives/text-link";
import {
  fetchAuthCapabilitiesWithApi,
  resolveOidcProviderName,
} from "@/lib/auth-capabilities";
import { authClient } from "@/lib/auth-client";
import { withSignupMarker } from "@/lib/signup-marker";
import {
  getMcpAuthorizationSearch,
  resolveClientPostAuthRedirect,
  resolvePathWithSearch,
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
  const capabilities = Route.useLoaderData();
  const search = Route.useSearch();
  const authorizationSearch = getMcpAuthorizationSearch(search) ?? undefined;
  const providerName = resolveOidcProviderName(capabilities);
  const [error, setError] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsRedirecting(true);

    const callbackURL = resolveClientPostAuthRedirect(authorizationSearch);
    const { error: signInError } = await authClient.signIn.oauth2({
      callbackURL,
      newUserCallbackURL: withSignupMarker(callbackURL, globalThis.location.origin),
      providerId: "oidc",
    });

    if (signInError) {
      setError(signInError.message ?? `Couldn't reach ${providerName}.`);
      setIsRedirecting(false);
    }
  };

  return (
    <>
      <Heading2 as="h1">Continue with {providerName}</Heading2>
      <Text size="sm" tone="muted" align="left">
        You'll be sent to {providerName} to sign in, then brought back here.
      </Text>
      <form onSubmit={handleSubmit} className="contents">
        <div className="flex items-stretch gap-2">
          <BackButton variant="border" size="standard" className="self-stretch justify-center px-3.5" />
          <Button type="submit" className="grow justify-center" disabled={isRedirecting}>
            <ButtonText>{isRedirecting ? "Redirecting..." : "Continue"}</ButtonText>
          </Button>
        </div>
      </form>
      {error && <Text size="sm" tone="danger">{error}</Text>}
      {!capabilities.disableLocalAuth && (
        <ExternalTextLink href={resolvePathWithSearch("/login", authorizationSearch)}>
          Sign in another way
        </ExternalTextLink>
      )}
    </>
  );
}
