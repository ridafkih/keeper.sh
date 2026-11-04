import { createFileRoute } from "@tanstack/react-router";
import { LinkOAuthPreamble } from "@/features/auth/components/oauth-preamble";

export const Route = createFileRoute("/(dashboard)/dashboard/connect/google")({
  component: () => <LinkOAuthPreamble provider="google" />,
});
