import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import Mail from "lucide-react/dist/esm/icons/mail";
import { authClient } from "../../lib/auth-client";
import { fetchAuthCapabilitiesWithApi } from "../../lib/auth-capabilities";
import { Button, ButtonText } from "../../components/ui/primitives/button";
import { Heading2 } from "../../components/ui/primitives/heading";
import { Text } from "../../components/ui/primitives/text";

export const Route = createFileRoute("/(auth)/verify-email")({
  loader: async ({ context }) => {
    const capabilities = await fetchAuthCapabilitiesWithApi(context.fetchApi);
    if (!capabilities.requiresEmailVerification) {
      throw redirect({ to: "/login" });
    }
    return capabilities;
  },
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const [email] = useState(() => {
    const stored = sessionStorage.getItem("pendingVerificationEmail");
    if (stored) sessionStorage.removeItem("pendingVerificationEmail");
    return stored;
  });
  const [callbackURL] = useState(() => {
    const stored = sessionStorage.getItem("pendingVerificationCallbackUrl");
    if (stored) sessionStorage.removeItem("pendingVerificationCallbackUrl");
    return stored ?? "/dashboard";
  });

  const handleResend = async () => {
    if (!email) return;

    setStatus("loading");
    setError(null);

    const { error } = await authClient.sendVerificationEmail({
      callbackURL,
      email,
    });

    if (error) {
      setError(error.message ?? "Failed to resend verification email");
      setStatus("idle");
      return;
    }

    setStatus("sent");
  };

  return (
    <>
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="p-3 rounded-full bg-background-muted">
          <Mail size={24} className="text-foreground-muted" />
        </div>
        <div className="flex flex-col">
          <Heading2 as="span" className="text-center">Check your email</Heading2>
          <Text size="sm" tone="muted" align="center">
            We sent a verification link to your email. Click the link to verify your account.
          </Text>
        </div>
      </div>
      {error && (
        <Text size="sm" tone="danger" align="center">{error}</Text>
      )}
      {status === "sent" && (
        <Text size="sm" tone="muted" align="center">Verification email sent.</Text>
      )}
      <Button
        variant="border"
        className="w-full justify-center"
        onClick={handleResend}
        disabled={!email || status === "loading"}
      >
        <ButtonText>Resend verification email</ButtonText>
      </Button>
    </>
  );
}
