"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { AuthFormContainer } from "@/components/auth-form";
import { Button } from "@/components/button";
import { useAuth } from "@/components/auth-provider";
import { authClient } from "@/lib/auth-client";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { CardTitle, TextBody } from "@/components/typography";
import { button } from "@/styles";

const getPendingEmail = (): string | null | undefined => {
  if (typeof window === "undefined") {
    return;
  }
  return sessionStorage.getItem("pendingVerificationEmail");
};

export default function VerifyEmailPage(): ReactNode {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { isSubmitting, error, submit } = useFormSubmit();

  useEffect(() => {
    if (!isLoading && user?.emailVerified) {
      sessionStorage.removeItem("pendingVerificationEmail");
      router.replace("/dashboard");
    }
  }, [user, isLoading, router]);

  const email = user?.email ?? getPendingEmail();

  const handleResend = async (): Promise<void> => {
    if (!email) {
      return;
    }

    await submit(async () => {
      const { error } = await authClient.sendVerificationEmail({
        callbackURL: "/dashboard",
        email,
      });

      if (error) {
        throw new Error(error.message ?? "Failed to resend verification email");
      }
    });
  };

  if (isLoading || user?.emailVerified) {
    return;
  }

  return (
    <AuthFormContainer>
      <div className="w-full max-w-xs p-4 rounded-md bg-surface text-center">
        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-full bg-surface-subtle">
            <Mail className="size-6 text-foreground-muted" />
          </div>
        </div>

        <CardTitle as="h1" className="mb-2">
          Check your email
        </CardTitle>

        <TextBody className="text-sm text-foreground-muted mb-4">
          We sent you a verification link. Click the link in your email to verify your account.
        </TextBody>

        {error && <TextBody className="text-sm text-destructive mb-4">{error}</TextBody>}

        <Button
          onClick={handleResend}
          isLoading={isSubmitting}
          disabled={!email}
          className={button({
            className: "w-full",
            size: "sm",
            variant: "secondary",
          })}
        >
          Resend verification email
        </Button>
      </div>
    </AuthFormContainer>
  );
}
