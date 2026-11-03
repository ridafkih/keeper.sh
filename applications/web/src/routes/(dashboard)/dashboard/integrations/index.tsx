import { createFileRoute, redirect } from "@tanstack/react-router";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { describeOAuthConnectFailure, isAdminApprovalFailure } from "@/lib/connect-failures";
import { AdminApproval } from "@/features/onboarding/components/admin-approval";

interface SearchParams {
  reason?: string;
  approvalUrl?: string;
}

function parseSearchString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return undefined;
}

export const Route = createFileRoute("/(dashboard)/dashboard/integrations/")({
  component: OAuthCallbackErrorPage,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    approvalUrl: parseSearchString(search.approvalUrl),
    reason: parseSearchString(search.reason),
  }),
  beforeLoad: ({ search }) => {
    if (!search.reason) {
      throw redirect({ to: "/dashboard" });
    }
  },
});

function OAuthCallbackErrorPage() {
  const { reason, approvalUrl } = Route.useSearch();

  if (isAdminApprovalFailure(reason) && approvalUrl) {
    return <AdminApproval approvalUrl={approvalUrl} />;
  }

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
