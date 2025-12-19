"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/header";
import { useAuth } from "@/components/auth-provider";
import {
  AuthFormContainer,
  AuthForm,
  AuthFormTitle,
  AuthFormError,
  AuthFormField,
  AuthFormSubmit,
  AuthFormFooter,
  styles,
} from "@/components/auth-form";
import { signUp } from "@/lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    const formData = new FormData(event.currentTarget);
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;
    const name = formData.get("name") as string;

    try {
      await signUp(username, password, name || undefined);
      await refresh();
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <Header />
      <AuthFormContainer>
        <AuthForm onSubmit={handleSubmit}>
          <AuthFormTitle>Register</AuthFormTitle>
          <AuthFormError message={error} />
          <AuthFormField
            name="username"
            label="Username"
            required
            minLength={3}
            maxLength={32}
            autoComplete="username"
          />
          <AuthFormField
            name="name"
            label="Name (optional)"
            autoComplete="name"
          />
          <AuthFormField
            name="password"
            label="Password"
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
          />
          <AuthFormSubmit isLoading={isLoading} loadingText="Creating account...">
            Create account
          </AuthFormSubmit>
          <AuthFormFooter>
            Already have an account?{" "}
            <Link href="/login" className={styles.footerLink}>
              Login
            </Link>
          </AuthFormFooter>
        </AuthForm>
      </AuthFormContainer>
    </>
  );
}
