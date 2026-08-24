import { createFileRoute } from "@tanstack/react-router";
import { LinkOAuthPreamble } from "@/features/auth/components/oauth-preamble";

export const Route = createFileRoute(
  "/(oauth)/dashboard/connect/microsoft",
)({
  component: () => <LinkOAuthPreamble provider="microsoft-365" />,
});
