import { createFileRoute, redirect } from "@tanstack/react-router";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { describeOAuthConnectFailure } from "@/lib/connect-failures";

interface SearchParams {
  reason?: string;
}

function parseSearchReason(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return undefined;
}

export const Route = createFileRoute("/(dashboard)/dashboard/integrations/")({
  component: OAuthCallbackErrorPage,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    reason: parseSearchReason(search.reason),
  }),
  beforeLoad: ({ search }) => {
    if (!search.reason) {
      throw redirect({ to: "/dashboard" });
    }
  },
});

function OAuthCallbackErrorPage() {
  const { reason } = Route.useSearch();

  return (
    <div className="flex flex-col gap-3">
      <BackButton />
      <div className="flex flex-col gap-1 py-2">
        <Heading2 as="span" className="text-center">Connection failed</Heading2>
        <Text size="sm" tone="muted" align="center">{describeOAuthConnectFailure(reason)}</Text>
      </div>
    </div>
  );
}
