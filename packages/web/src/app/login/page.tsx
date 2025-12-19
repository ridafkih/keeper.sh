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
} from "@/components/auth-form";
import { signIn } from "@/lib/auth";
import { link } from "@/styles";

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
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");

    try {
      await signIn(username, password);
      await refresh();
      router.push("/dashboard");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign in failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
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
            <Link href="/register" className={link()}>
              Register
            </Link>
          </AuthFormFooter>
        </AuthForm>
      </AuthFormContainer>
    </div>
  );
}
