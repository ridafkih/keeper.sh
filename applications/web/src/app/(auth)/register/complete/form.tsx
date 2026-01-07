"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AuthForm,
  AuthFormError,
  AuthFormField,
  AuthFormFooter,
  AuthFormSubmit,
  AuthFormTitle,
} from "@/components/auth-form";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { signUpWithEmail } from "@/lib/auth";
import { track } from "@/lib/analytics";

const subscribeToStorage = (callback: () => void): (() => void) => {
  window.addEventListener("storage", callback);
  return (): void => window.removeEventListener("storage", callback);
};

const getRegistrationEmail = (): string | null => sessionStorage.getItem("registrationEmail");
const getServerSnapshot = (): null => null;

export const CompleteRegistrationForm = (): ReactNode => {
  const router = useRouter();
  const { isSubmitting, error, submit } = useFormSubmit();
  const passwordRef = useRef<HTMLInputElement>(null);

  const email = useSyncExternalStore(subscribeToStorage, getRegistrationEmail, getServerSnapshot);

  useEffect(() => {
    if (email !== null) {
      return;
    }
    router.replace("/register");
  }, [email, router]);

  useEffect(() => {
    passwordRef.current?.focus();
  }, [email]);

  if (!email) {
    return;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");

    await submit(async () => {
      await signUpWithEmail(email, password);
      track("registration_completed");
      sessionStorage.setItem("pendingVerificationEmail", email);
      router.push("/verify-email");
    });
  };

  return (
    <AuthForm onSubmit={handleSubmit}>
      <AuthFormTitle>Complete Registration</AuthFormTitle>
      <AuthFormError message={error} />
      <AuthFormField
        name="email"
        placeholder="Email"
        type="email"
        disabled
        value={email}
        autoComplete="email"
      />
      <AuthFormField
        name="password"
        placeholder="Password"
        type="password"
        required
        minLength={8}
        maxLength={128}
        autoComplete="new-password"
        inputRef={passwordRef}
      />
      <AuthFormSubmit isLoading={isSubmitting}>Create account</AuthFormSubmit>
      <AuthFormFooter>
        Already have an account?{" "}
        <Link href="/login" className="text-foreground font-medium no-underline hover:underline">
          Login
        </Link>
      </AuthFormFooter>
    </AuthForm>
  );
};
