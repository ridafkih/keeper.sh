import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { Divider } from "@/components/ui/primitives/divider";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import {
  PermissionsList,
  ProviderIconPair,
} from "@/features/auth/components/oauth-preamble";
import {
  getMcpAuthorizationSearch,
  toStringSearchParams,
} from "@/lib/mcp-auth-flow";
import { resolveErrorMessage } from "@/utils/errors";

type SearchParams = Record<string, string>;

const SCOPE_LABELS: Record<string, string> = {
  "keeper.read": "Read your Keeper data",
  "keeper.sources.read": "View your calendar sources",
  "keeper.destinations.read": "View your sync destinations",
  "keeper.mappings.read": "View your source-destination mappings",
  "keeper.events.read": "View your calendar events",
  "keeper.sync-status.read": "View sync status",
  "offline_access": "Stay connected when you're away",
};

const resolveScopeLabel = (scope: string): string => {
  const label = SCOPE_LABELS[scope];
  if (label) {
    return label;
  }
  return scope;
};

// This route lives under (oauth)/mcp rather than (oauth)/auth/mcp because
// the (oauth)/auth layout redirects logged-in users away, but the consent
// page requires an active session.
export const Route = createFileRoute("/(oauth)/oauth/consent")({
  beforeLoad: ({ search }) => {
    if (!getMcpAuthorizationSearch(search)) {
      throw redirect({ to: "/login", search });
    }
  },
  component: McpConsentPage,
  validateSearch: (search: Record<string, unknown>): SearchParams => toStringSearchParams(search),
});

function extractConsentErrorMessage(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "Failed to complete consent";
  }
  if (!("message" in payload)) {
    return "Failed to complete consent";
  }
  if (typeof payload.message !== "string") {
    return "Failed to complete consent";
  }
  return payload.message;
}

function extractConsentRedirectUrl(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("Expected consent response to contain a redirect URL");
  }
  if (!("url" in payload) || typeof payload.url !== "string") {
    throw new TypeError("Expected consent response to contain a redirect URL");
  }
  return payload.url;
}

function McpConsentPage() {
  const search = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const authorizationSearch = getMcpAuthorizationSearch(search);

  if (!authorizationSearch) {
    return null;
  }

  const { client_id: clientId, scope } = authorizationSearch;
  const scopes = scope
    .split(" ")
    .filter((value) => value.length > 0)
    .map(resolveScopeLabel);

  const handleDecision = async (accept: boolean) => {
    setStatus("loading");
    setError(null);

    try {
      const oauthQuery = window.location.search.slice(1);

      const response = await fetch("/api/auth/oauth2/consent", {
        body: JSON.stringify({
          accept,
          oauth_query: oauthQuery,
        }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(extractConsentErrorMessage(payload));
      }

      const payload = await response.json();
      window.location.assign(extractConsentRedirectUrl(payload));
    } catch (requestError) {
      setError(resolveErrorMessage(requestError, "Failed to complete consent"));
      setStatus("idle");
    }
  };

  return (
    <>
      <ProviderIconPair>
        <Terminal className="size-full text-foreground-muted" />
      </ProviderIconPair>
      <Heading2 as="h1">Authorize MCP access</Heading2>
      <Text size="sm" tone="muted" align="left">
        {clientId} is requesting permission to access your Keeper data.
      </Text>
      {scopes.length > 0 && <PermissionsList items={scopes} />}
      {error && (
        <Text size="sm" tone="danger" align="center">{error}</Text>
      )}
      <Divider />
      <div className="flex items-stretch gap-2">
        <Button
          type="button"
          variant="border"
          className="grow justify-center"
          disabled={status === "loading"}
          onClick={() => {
            void handleDecision(false);
          }}
        >
          <ButtonText>Deny</ButtonText>
        </Button>
        <Button
          type="button"
          className="grow justify-center"
          disabled={status === "loading"}
          onClick={() => {
            void handleDecision(true);
          }}
        >
          <ButtonText>Allow</ButtonText>
        </Button>
      </div>
    </>
  );
}
