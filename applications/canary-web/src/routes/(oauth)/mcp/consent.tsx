import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right";
import Check from "lucide-react/dist/esm/icons/check";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import KeeperLogo from "../../../assets/keeper.svg?react";
import { Button, ButtonText } from "../../../components/ui/primitives/button";
import { Divider } from "../../../components/ui/primitives/divider";
import { Heading2 } from "../../../components/ui/primitives/heading";
import { Text } from "../../../components/ui/primitives/text";
import {
  getMcpAuthorizationSearch,
  toStringSearchParams,
} from "../../../lib/mcp-auth-flow";
import { resolveErrorMessage } from "../../../utils/errors";

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

const resolveScopeLabel = (scope: string): string =>
  SCOPE_LABELS[scope] ?? scope;

export const Route = createFileRoute("/(oauth)/mcp/consent")({
  beforeLoad: ({ search }) => {
    if (!getMcpAuthorizationSearch(search)) {
      throw redirect({ to: "/login", search });
    }
  },
  component: McpConsentPage,
  validateSearch: (search: Record<string, unknown>): SearchParams => toStringSearchParams(search),
});

function McpConsentPage() {
  const search = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const continuationSearch = getMcpAuthorizationSearch(search);

  if (!continuationSearch) {
    return null;
  }

  const { client_id: clientId, scope } = continuationSearch;
  const scopes = scope
    ?.split(" ")
    .filter((value) => value.length > 0)
    ?? [];

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
        throw new Error(
          typeof payload === "object"
          && payload !== null
          && "message" in payload
          && typeof payload.message === "string"
            ? payload.message
            : "Failed to complete consent",
        );
      }

      const payload = await response.json() as { url: string };
      window.location.assign(payload.url);
    } catch (requestError) {
      setError(resolveErrorMessage(requestError, "Failed to complete consent"));
      setStatus("idle");
    }
  };

  return (
    <>
      <div className="flex items-center justify-center gap-4 pb-4">
        <div className="size-14 rounded-xl border border-interactive-border shadow-xs p-3 flex items-center justify-center bg-background-inverse">
          <KeeperLogo className="size-full rounded-lg text-foreground-inverse p-1" />
        </div>
        <ArrowLeftRight size={20} className="text-foreground-muted" />
        <div className="size-14 rounded-xl border border-interactive-border shadow-xs p-3 flex items-center justify-center">
          <Terminal className="size-full text-foreground-muted" />
        </div>
      </div>
      <Heading2 as="h1">Authorize MCP access</Heading2>
      <Text size="sm" tone="muted" align="left">
        {clientId} is requesting permission to access your Keeper data.
      </Text>
      {scopes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {scopes.map((requestedScope) => (
            <li key={requestedScope} className="flex flex-row-reverse justify-between items-center gap-2">
              <Check className="shrink-0 text-foreground-muted" size={16} />
              <Text size="sm" tone="muted" align="left">{resolveScopeLabel(requestedScope)}</Text>
            </li>
          ))}
        </ul>
      )}
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
