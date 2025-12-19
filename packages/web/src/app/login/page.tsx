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
import { signIn } from "@/lib/auth";

export default function LoginPage() {
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

    try {
      await signIn(username, password);
      await refresh();
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <Header />
      <AuthFormContainer>
        <AuthForm onSubmit={handleSubmit}>
          <AuthFormTitle>Login</AuthFormTitle>
          <AuthFormError message={error} />
          <AuthFormField
            name="username"
            label="Username"
            required
            autoComplete="username"
          />
          <AuthFormField
            name="password"
            label="Password"
            type="password"
            required
            autoComplete="current-password"
          />
          <AuthFormSubmit isLoading={isLoading} loadingText="Signing in...">
            Sign in
          </AuthFormSubmit>
          <AuthFormFooter>
            Don&apos;t have an account?{" "}
            <Link href="/register" className={styles.footerLink}>
              Register
            </Link>
          </AuthFormFooter>
        </AuthForm>
      </AuthFormContainer>
    </>
  );
}
