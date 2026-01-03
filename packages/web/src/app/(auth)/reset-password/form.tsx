"use client";

import type { FC } from "react";
import { useState } from "react";
import Link from "next/link";
import { CheckCircle } from "lucide-react";
import {
  AuthFormContainer,
  AuthForm,
  AuthFormTitle,
  AuthFormError,
  AuthFormField,
  AuthFormSubmit,
} from "@/components/auth-form";
import { CardTitle, TextBody } from "@/components/typography";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { resetPassword } from "@/lib/auth";

interface ResetPasswordFormProps {
  token: string;
}

export const ResetPasswordForm: FC<ResetPasswordFormProps> = ({ token }) => {
  const [success, setSuccess] = useState(false);
  const { isSubmitting, error, submit } = useFormSubmit();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (password !== confirmPassword) {
      return;
    }

    await submit(async () => {
      await resetPassword(token, password);
      setSuccess(true);
    });
  };

  if (success) {
    return (
      <div className="w-full max-w-xs p-4 rounded-md bg-surface text-center flex flex-col gap-2">
        <div className="flex justify-center">
          <div className="p-3 rounded-full bg-success-surface">
            <CheckCircle className="size-6 text-success-emphasis" />
          </div>
        </div>

        <CardTitle as="h1">Password reset</CardTitle>

        <TextBody className="text-sm text-foreground-muted">
          Your password has been successfully reset.
        </TextBody>

        <Link
          href="/login"
          className="text-sm text-foreground font-medium hover:underline"
        >
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <AuthForm onSubmit={handleSubmit}>
      <AuthFormTitle>Set new password</AuthFormTitle>
      <AuthFormError message={error} />

      <AuthFormField
        name="password"
        placeholder="New password"
        type="password"
        required
        minLength={8}
        maxLength={128}
        autoComplete="new-password"
      />

      <AuthFormField
        name="confirmPassword"
        placeholder="Confirm password"
        type="password"
        required
        minLength={8}
        maxLength={128}
        autoComplete="new-password"
      />

      <AuthFormSubmit isLoading={isSubmitting}>Reset password</AuthFormSubmit>
    </AuthForm>
  );
};

export const InvalidTokenMessage: FC = () => (
  <div className="w-full max-w-xs p-4 rounded-md bg-surface text-center flex flex-col gap-2">
    <CardTitle as="h1">Invalid link</CardTitle>

    <TextBody className="text-sm text-foreground-muted">
      This password reset link is invalid or has expired.
    </TextBody>

    <Link
      href="/forgot-password"
      className="text-sm text-foreground font-medium hover:underline"
    >
      Request a new link
    </Link>
  </div>
);
