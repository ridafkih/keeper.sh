"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import {
  AuthForm,
  AuthFormContainer,
  AuthFormError,
  AuthFormField,
  AuthFormFooter,
  AuthFormSubmit,
  AuthFormTitle,
} from "@/components/auth-form";
import { CardTitle, TextBody } from "@/components/typography";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { forgotPassword } from "@/lib/auth";

export default function ForgotPasswordPage(): ReactNode {
  const [emailSent, setEmailSent] = useState(false);
  const { isSubmitting, error, submit } = useFormSubmit();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");

    await submit(async () => {
      await forgotPassword(email);
      setEmailSent(true);
    });
  };

  if (emailSent) {
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
            If an account exists with that email, we sent you a password reset link.
          </TextBody>

          <Link href="/login" className="text-sm text-foreground font-medium hover:underline">
            Back to login
          </Link>
        </div>
      </AuthFormContainer>
    );
  }

  return (
    <AuthFormContainer>
      <AuthForm onSubmit={handleSubmit}>
        <AuthFormTitle>Reset password</AuthFormTitle>

        <TextBody className="text-sm text-foreground-muted mb-3 text-center">
          Enter your email and we&apos;ll send you a link to reset your password.
        </TextBody>

        <AuthFormError message={error} />

        <AuthFormField
          name="email"
          placeholder="Email"
          type="email"
          required
          autoComplete="email"
        />

        <AuthFormSubmit isLoading={isSubmitting}>Send reset link</AuthFormSubmit>

        <AuthFormFooter>
          Remember your password?{" "}
          <Link href="/login" className="text-foreground font-medium no-underline hover:underline">
            Login
          </Link>
        </AuthFormFooter>
      </AuthForm>
    </AuthFormContainer>
  );
}
