import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSession } from "@/hooks/use-session";
import { Text } from "@/components/ui/primitives/text";

export const Route = createFileRoute("/(auth)/verify-authentication")({
  component: VerifyAuthenticationPage,
});

function VerifyAuthenticationPage() {
  const navigate = useNavigate();
  const { user, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading && user) navigate({ to: "/dashboard" });
  }, [user, isLoading, navigate]);

  return (
    <Text size="sm" tone="muted" align="center">Redirecting...</Text>
  );
}
