import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import Mail from "lucide-react/dist/esm/icons/mail";
import { forgotPassword } from "@/lib/auth";
import { fetchAuthCapabilitiesWithApi } from "@/lib/auth-capabilities";
import { resolveErrorMessage } from "@/utils/errors";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Input } from "@/components/ui/primitives/input";
import { Text } from "@/components/ui/primitives/text";
import { TextLink } from "@/components/ui/primitives/text-link";
import { AuthSwitchPrompt } from "@/features/auth/components/auth-switch-prompt";

export const Route = createFileRoute("/(auth)/forgot-password")({
  loader: async ({ context }) => {
    const capabilities = await fetchAuthCapabilitiesWithApi(context.fetchApi);
    if (!capabilities.supportsPasswordReset) {
      throw redirect({ to: "/login" });
    }
    return capabilities;
  },
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (status === "sent") return <SuccessState />;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    if (!email) return;

    setStatus("loading");
    setError(null);

    try {
      await forgotPassword(email);
      setStatus("sent");
    } catch (err) {
      setError(resolveErrorMessage(err, "Failed to send reset email"));
      setStatus("idle");
    }
  };

  return (
    <>
      <div className="flex flex-col py-2">
        <Heading2 as="span" className="text-center">Reset password</Heading2>
        <Text size="sm" tone="muted" align="center">
          Enter your email and we&apos;ll send you a link to reset your password.
        </Text>
      </div>
      {error && <Text size="sm" tone="danger" align="center">{error}</Text>}
      <form onSubmit={handleSubmit} className="contents">
        <Input name="email" type="email" placeholder="johndoe+keeper@example.com" required autoComplete="email" />
        <Button type="submit" className="w-full justify-center" disabled={status === "loading"}>
          <ButtonText>Send reset link</ButtonText>
        </Button>
      </form>
      <AuthSwitchPrompt>
        Remember your password? <TextLink to="/login">Sign in</TextLink>
      </AuthSwitchPrompt>
    </>
  );
}

function SuccessState() {
  return (
    <>
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="p-3 rounded-full bg-background-hover">
          <Mail size={24} className="text-foreground-muted" />
        </div>
        <div className="flex flex-col">
          <Heading2 as="span" className="text-center">Check your email</Heading2>
          <Text size="sm" tone="muted" align="center">
            If an account exists with that email, we sent you a password reset link.
          </Text>
        </div>
      </div>
      <TextLink to="/login">Back to sign in</TextLink>
    </>
  );
}
