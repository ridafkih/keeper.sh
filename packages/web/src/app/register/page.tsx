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
import { signUp } from "@/lib/auth";
import { link } from "@/styles";

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
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "") || undefined;

    try {
      await signUp(username, password, name);
      await refresh();
      router.push("/dashboard");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign up failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
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
          <AuthFormSubmit
            isLoading={isLoading}
            loadingText="Creating account..."
          >
            Create account
          </AuthFormSubmit>
          <AuthFormFooter>
            Already have an account?{" "}
            <Link href="/login" className={link()}>
              Login
            </Link>
          </AuthFormFooter>
        </AuthForm>
      </AuthFormContainer>
    </div>
  );
}
